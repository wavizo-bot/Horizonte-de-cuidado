package horizonte.de.cuidado;

import android.accounts.Account;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Looper;
import android.util.Log;

import com.google.android.gms.auth.GoogleAuthException;
import com.google.android.gms.auth.GoogleAuthUtil;
import com.google.android.gms.auth.UserRecoverableAuthException;
import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Tasks;

import org.json.JSONObject;

import java.io.IOException;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Login Google nativo (Google Identity / Google Play services), sem navegador
 * e sem WebView embutida — a regra A8 proíbe as duas coisas. O Google
 * identifica o aplicativo pelo package + SHA-1 do certificado que assinou o
 * APK; nenhum client secret precisa ir para o pacote.
 *
 * O consentimento acontece no seletor de contas do próprio Android. Depois do
 * login, o token de acesso é obtido com GoogleAuthUtil e conferido no
 * tokeninfo (precisa conter drive.appdata). A renovação é silenciosa pelo
 * GoogleAuthUtil enquanto a conta continuar autorizada; o token fica cifrado
 * no AndroidKeyStore via AuthStore.
 */
final class OAuthFlow {

    static final int REQ_SIGN_IN = 7301;
    static final String DRIVE_SCOPE =
            "https://www.googleapis.com/auth/drive.appdata";
    private static final String TOKENINFO =
            "https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=";
    private static final long LOGIN_TIMEOUT_MS = 120000L;
    private static final int SIGN_IN_CANCELLED = 12501;
    private static final int SIGN_IN_DEVELOPER_ERROR = 10;
    private static final String TAG = "HorizonteOAuth";

    static final class AuthError extends Exception {
        AuthError(String message) {
            super(message);
        }
    }

    private final Context ctx;
    private final AuthStore store;
    private final GoogleSignInClient client;

    private final Object loginLock = new Object();
    private CountDownLatch loginLatch;
    private AtomicReference<GoogleSignInAccount> loginAccount;
    private AtomicReference<Exception> loginFailure;

    private String accessToken;
    private long accessExpiresAt;

    OAuthFlow(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.store = new AuthStore(ctx);
        GoogleSignInOptions options = new GoogleSignInOptions.Builder(
                GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestEmail()
                .requestScopes(new Scope(DRIVE_SCOPE))
                .build();
        this.client = GoogleSignIn.getClient(this.ctx, options);
    }

    /** Só considera conectado quando há uma conta Google efetivamente salva. */
    boolean hasSession() {
        return !store.email().isEmpty();
    }

    /** Confere de verdade: obtém (ou renova) um token com o escopo do Drive. */
    void ensureSession() throws AuthError {
        accessToken();
    }

    String email() {
        return store.email();
    }

    /**
     * Token utilizável agora. Usa o token em memória, depois o token cifrado
     * ainda válido e, por fim, renova silenciosamente com GoogleAuthUtil.
     */
    synchronized String accessToken() throws AuthError {
        if (accessToken != null && System.currentTimeMillis() < accessExpiresAt - 60000L) {
            return accessToken;
        }

        String saved = store.token();
        long savedExpiry = store.expiresAt();
        if (saved != null && savedExpiry > System.currentTimeMillis() + 60000L) {
            accessToken = saved;
            accessExpiresAt = savedExpiry;
            return saved;
        }

        GoogleSignInAccount signIn = GoogleSignIn.getLastSignedInAccount(ctx);
        Account account = accountOf(signIn);
        if (account == null) {
            throw new AuthError("Entre com a conta Google para sincronizar.");
        }

        String scopes = scopeString(signIn);
        try {
            Log.i(TAG, "Obtendo token Google para " + account.name);
            String token = GoogleAuthUtil.getToken(ctx, account, scopes);
            TokenInfo info = verifyToken(token);
            accessToken = token;
            accessExpiresAt = info.expiresAt;
            store.saveToken(token, info.expiresAt);
            if (store.email().isEmpty()) {
                String mail = info.email;
                if ((mail == null || mail.isEmpty()) && signIn != null) mail = signIn.getEmail();
                if (mail != null && !mail.isEmpty()) store.setEmail(mail);
            }
            Log.i(TAG, "Token Google validado com o escopo drive.appdata");
            return token;
        } catch (UserRecoverableAuthException e) {
            store.clearToken();
            Log.w(TAG, "O Google pediu consentimento adicional", e);
            throw new AuthError("A autorização do Google precisa ser renovada. "
                    + "Toque em Conectar Google Drive e conclua o login.");
        } catch (GoogleAuthException e) {
            store.clearToken();
            Log.w(TAG, "Falha ao renovar o token Google", e);
            throw new AuthError("Não foi possível renovar o acesso ao Google. "
                    + "Entre novamente com a conta Google.");
        } catch (IOException e) {
            Log.w(TAG, "Falha de rede ao obter o token Google", e);
            throw new AuthError("Sem conexão com o Google. Verifique a internet e tente de novo.");
        }
    }

    synchronized void invalidateAccessToken() {
        accessToken = null;
        accessExpiresAt = 0;
        store.clearToken();
    }

    /**
     * Abre o seletor nativo de contas do Google e espera o resultado. Chamado
     * em thread de trabalho; o resultado chega pelo onActivityResult da
     * Activity e libera o latch. Sem Custom Tabs, sem navegador externo.
     */
    void signIn(Activity activity) throws Exception {
        if (activity == null) {
            throw new AuthError("App indisponível no momento. Abra o Horizonte de Cuidado novamente.");
        }

        // Já conectado e o token renova sozinho: não mostra o seletor de novo.
        if (hasSession()) {
            try {
                accessToken();
                return;
            } catch (AuthError e) {
                // Conta antiga sem autorização válida: pede o consentimento
                // novamente em vez de manter a UI "conectada" sem funcionar.
                Log.w(TAG, "Sessão antiga inválida; pedindo login novamente", e);
                store.clear();
            }
        }

        Log.i(TAG, "Abrindo seletor de contas do Google");

        final CountDownLatch latch = new CountDownLatch(1);
        final AtomicReference<GoogleSignInAccount> accountRef = new AtomicReference<>();
        final AtomicReference<Exception> failureRef = new AtomicReference<>();
        synchronized (loginLock) {
            loginLatch = latch;
            loginAccount = accountRef;
            loginFailure = failureRef;
        }

        try {
            activity.runOnUiThread(() -> {
                try {
                    activity.startActivityForResult(client.getSignInIntent(), REQ_SIGN_IN);
                } catch (Exception e) {
                    failureRef.set(e);
                    latch.countDown();
                }
            });

            boolean done = latch.await(LOGIN_TIMEOUT_MS, TimeUnit.MILLISECONDS);
            if (!done) {
                Log.w(TAG, "Tempo esgotado esperando o onActivityResult do Google Sign-In");
                throw new AuthError("O login expirou. Toque em Conectar Google Drive e tente novamente.");
            }
            Log.i(TAG, "Resultado do seletor de contas recebido");
            Exception failure = failureRef.get();
            if (failure != null) {
                Log.w(TAG, "Falha no login Google", failure);
                // Preserva o motivo real (cancelamento, SHA-1, Play services)
                // em vez de trocar tudo por "não foi possível abrir".
                if (failure instanceof AuthError) throw (AuthError) failure;
                throw new AuthError("Não foi possível abrir o seletor de contas do Google. "
                        + "Verifique se o Google Play services está atualizado.");
            }
            GoogleSignInAccount account = accountRef.get();
            if (account == null) {
                throw new AuthError("Login não concluído. Tente novamente.");
            }

            String mail = account.getEmail();
            Log.i(TAG, "Conta Google escolhida: " + mail);
            if (mail != null && !mail.isEmpty()) store.setEmail(mail);

            // Confere o escopo concedido antes de considerar o login concluído.
            Set<Scope> granted = account.getGrantedScopes();
            if (granted != null && !granted.isEmpty() && !containsDrive(granted)) {
                store.clear();
                throw new AuthError("A permissão do Google Drive não foi concedida. "
                        + "Entre novamente e marque a caixa de acesso ao Google Drive.");
            }

            // O tokeninfo valida o token e o escopo drive.appdata de verdade.
            accessToken();
        } finally {
            synchronized (loginLock) {
                loginLatch = null;
                loginAccount = null;
                loginFailure = null;
            }
        }
    }

    /**
     * Encaminhado pelo MainActivity/HostBridge. Devolve true quando o
     * resultado é do login Google e já foi tratado.
     */
    boolean onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQ_SIGN_IN) return false;

        Log.i(TAG, "onActivityResult do login: resultCode=" + resultCode
                + ", data=" + (data != null));

        CountDownLatch latch;
        AtomicReference<GoogleSignInAccount> accountRef;
        AtomicReference<Exception> failureRef;
        synchronized (loginLock) {
            latch = loginLatch;
            accountRef = loginAccount;
            failureRef = loginFailure;
        }

        GoogleSignInAccount account = null;
        Exception failure = null;
        try {
            if (data == null) {
                throw new AuthError("Login cancelado.");
            }
            account = GoogleSignIn
                    .getSignedInAccountFromIntent(data)
                    .getResult(ApiException.class);
            if (account == null) throw new AuthError("Login não concluído. Tente novamente.");
            Log.i(TAG, "Conta recebida do Google: " + account.getEmail()
                    + "; escopos=" + account.getGrantedScopes());
        } catch (ApiException e) {
            Log.w(TAG, "Google Sign-In recusou o login: código " + e.getStatusCode(), e);
            failure = authError(e);
        } catch (Exception e) {
            Log.w(TAG, "Falha ao ler o resultado do Google Sign-In", e);
            failure = e;
        }

        if (latch != null) {
            if (account != null) {
                accountRef.set(account);
            } else {
                failureRef.set(failure);
            }
            latch.countDown();
            return true;
        }

        // A Activity pode ter sido recriada enquanto o seletor estava aberto.
        // Nesse caso o latch e o WebView antigos não existem mais; persistir a
        // conta/token permite que o app recarregado encontre a sessão.
        if (account != null) {
            final GoogleSignInAccount chosen = account;
            Thread resume = new Thread(() -> {
                try {
                    String mail = chosen.getEmail();
                    if (mail != null && !mail.isEmpty()) store.setEmail(mail);
                    accessToken();
                    Log.i(TAG, "Login concluído após recriação da Activity");
                } catch (Exception e) {
                    Log.w(TAG, "Falha ao concluir login após recriação da Activity", e);
                }
            }, "HorizonteOAuth-resume");
            resume.setDaemon(true);
            resume.start();
        } else if (failure != null) {
            Log.w(TAG, "Resultado de login sem waiter: " + failure.getMessage());
        }
        return true;
    }

    private static AuthError authError(ApiException e) {
        if (e.getStatusCode() == SIGN_IN_CANCELLED) {
            return new AuthError("Login cancelado.");
        }
        if (e.getStatusCode() == SIGN_IN_DEVELOPER_ERROR) {
            return new AuthError("O Google não reconhece este aplicativo. "
                    + "O pacote e o SHA-1 do APK precisam estar cadastrados no cliente "
                    + "OAuth Android do projeto.");
        }
        return new AuthError("O Google recusou o login (código "
                + e.getStatusCode() + "). Tente novamente.");
    }

    void signOut() {
        accessToken = null;
        accessExpiresAt = 0;
        store.clear();
        try {
            if (Looper.myLooper() != Looper.getMainLooper()) {
                Tasks.await(client.signOut(), 10, TimeUnit.SECONDS);
            } else {
                client.signOut();
            }
        } catch (Exception e) {
            Log.w(TAG, "Falha ao limpar a conta Google do Play services", e);
        }
    }

    /* ------------------------------------------------------------- token -- */

    private static final class TokenInfo {
        long expiresAt;
        String email;
    }

    private TokenInfo verifyToken(String token) throws AuthError, IOException {
        Http.Resp r = Http.send("GET", TOKENINFO + Uri.encode(token), null, null, null);
        if (!r.ok()) {
            store.clearToken();
            throw new AuthError("O Google recusou o token de acesso. Entre novamente.");
        }
        try {
            JSONObject j = new JSONObject(r.body);
            String scope = j.optString("scope", "");
            if (!scope.contains("drive.appdata")) {
                store.clear();
                throw new AuthError("A permissão do Google Drive não foi concedida. "
                        + "Entre novamente e marque a caixa de acesso ao Google Drive.");
            }
            long expiresIn = j.optLong("expires_in", 0);
            if (expiresIn < 60) {
                store.clearToken();
                throw new AuthError("O Google devolveu um token já expirado. Tente novamente.");
            }
            TokenInfo info = new TokenInfo();
            info.expiresAt = System.currentTimeMillis() + expiresIn * 1000L;
            info.email = j.optString("email", "");
            return info;
        } catch (AuthError e) {
            throw e;
        } catch (Exception e) {
            throw new AuthError("Resposta inválida do Google ao validar o acesso.");
        }
    }

    private Account accountOf(GoogleSignInAccount signIn) {
        if (signIn != null && signIn.getAccount() != null) {
            return signIn.getAccount();
        }
        String mail = store.email();
        if (!mail.isEmpty()) return new Account(mail, "com.google");
        return null;
    }

    private String scopeString(GoogleSignInAccount signIn) {
        StringBuilder sb = new StringBuilder("oauth2:");
        boolean first = true;
        Set<Scope> granted = signIn == null ? null : signIn.getGrantedScopes();
        if (granted != null) {
            for (Scope scope : granted) {
                if (!first) sb.append(' ');
                sb.append(scope.getScopeUri());
                first = false;
            }
        }
        if (first) sb.append(DRIVE_SCOPE);
        return sb.toString();
    }

    private static boolean containsDrive(Set<Scope> scopes) {
        for (Scope scope : scopes) {
            if (DRIVE_SCOPE.equals(scope.getScopeUri())) return true;
        }
        return false;
    }

    /** Mensagem legível de um erro JSON do Google (usada também pela DriveApi). */
    static String jsonError(String body) {
        try {
            JSONObject j = new JSONObject(body);
            JSONObject err = j.optJSONObject("error");
            if (err != null) {
                String msg = err.optString("message", "");
                if (!msg.isEmpty()) return msg;
            }
            String s = j.optString("error_description", "");
            if (!s.isEmpty()) return s;
            return j.optString("error", "erro desconhecido");
        } catch (Exception e) {
            return body == null || body.isEmpty()
                    ? "erro desconhecido"
                    : body.substring(0, Math.min(160, body.length()));
        }
    }
}

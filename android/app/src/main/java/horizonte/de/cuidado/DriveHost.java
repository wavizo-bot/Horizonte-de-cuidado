package horizonte.de.cuidado;

import android.app.Activity;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.util.List;

/**
 * Implementa o MESMO contrato que o host WebView2 do MSIX expõe ao app web:
 * DriveGetState, DriveLogin, DriveLogout, DriveCheckRemote, DriveRestoreFile,
 * DriveBackup e DriveResetCloud. Toda falha vira {ok:false,error}, nunca
 * reject, porque o sync.ts marca o host como quebrado ao primeiro reject.
 *
 * Login: Google Identity nativo (Google Play services), sem navegador e sem
 * WebView embutida (regra A8). O Google identifica o app pelo package + SHA-1;
 * a renovação é silenciosa pelo GoogleAuthUtil e o token fica cifrado no
 * AndroidKeyStore (regra 5.8.1).
 */
final class DriveHost {

    private static final String DRIVE_SCOPE =
            "https://www.googleapis.com/auth/drive.appdata";

    private final Activity activity;
    private final Context ctx;
    private final Handler main = new Handler(Looper.getMainLooper());

    private OAuthFlow oauth;
    private DriveApi drive;
    private volatile boolean loginBusy;

    DriveHost(Activity activity) {
        this.activity = activity;
        this.ctx = activity.getApplicationContext();
    }

    private synchronized OAuthFlow oauth() throws Exception {
        if (oauth == null) {
            oauth = new OAuthFlow(ctx);
            drive = new DriveApi(oauth);
        }
        return oauth;
    }

    private synchronized DriveApi drive() throws Exception {
        oauth();
        return drive;
    }

    String getState() {
        JSONObject o = new JSONObject();
        try {
            OAuthFlow f = oauth();
            boolean signed = f.hasSession();
            o.put("ok", true);
            o.put("configured", true);
            o.put("signedIn", signed);
            o.put("email", signed ? f.email() : JSONObject.NULL);
        } catch (Exception e) {
            try {
                o.put("ok", false);
                o.put("configured", false);
                o.put("signedIn", false);
                o.put("error", "O cliente OAuth do Google não está configurado neste pacote.");
            } catch (Exception ignored) {}
        }
        return o.toString();
    }

    String login() {
        if (!loginBusy) {
            loginBusy = true;
        } else {
            return error("Já existe um login em andamento.");
        }
        try {
            OAuthFlow f = oauth();
            // signIn já reaproveita uma sessão válida e só abre o seletor de
            // contas do Android quando precisa de novo consentimento.
            f.signIn(activity);
            f.ensureSession();
            String email = f.email();
            toast(email == null || email.isEmpty()
                    ? "Conta Google conectada."
                    : "Conectado: " + email);
            return signedIn(email);
        } catch (Exception e) {
            return loginError(message(e));
        } finally {
            loginBusy = false;
        }
    }

    String logout() {
        try {
            if (oauth != null) oauth.signOut();
            JSONObject o = new JSONObject();
            o.put("ok", true);
            return o.toString();
        } catch (Exception e) {
            return error(message(e));
        }
    }

    /** Resultado do seletor de contas do Google, encaminhado pela Activity. */
    void onActivityResult(int requestCode, int resultCode, android.content.Intent data) {
        OAuthFlow f;
        synchronized (this) {
            f = oauth;
        }
        if (f != null) f.onActivityResult(requestCode, resultCode, data);
    }

    String checkRemote() {
        try {
            OAuthFlow f = oauth();
            if (!f.hasSession()) throw new OAuthFlow.AuthError("Entre com a conta Google.");
            List<DriveApi.FileInfo> all = drive().list();
            JSONArray files = new JSONArray();
            long max = 0;
            for (DriveApi.FileInfo file : all) {
                JSONObject item = new JSONObject();
                item.put("id", file.id);
                item.put("name", file.name);
                item.put("modifiedTime", file.modifiedTime);
                item.put("size", file.size);
                files.put(item);
                if (file.modifiedTime > max) max = file.modifiedTime;
            }
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("exists", all.size() > 0);
            o.put("files", files);
            o.put("modifiedTime", max);
            return o.toString();
        } catch (Exception e) {
            return error(message(e));
        }
    }

    String restoreFile(String fileId) {
        try {
            OAuthFlow f = oauth();
            if (!f.hasSession()) throw new OAuthFlow.AuthError("Entre com a conta Google.");
            if (fileId == null || fileId.isEmpty()) {
                throw new OAuthFlow.AuthError("Arquivo de backup inválido.");
            }
            String payload = drive().download(fileId);
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("payload", payload);
            return o.toString();
        } catch (Exception e) {
            return error(message(e));
        }
    }

    String backup(String payload) {
        try {
            OAuthFlow f = oauth();
            if (!f.hasSession()) throw new OAuthFlow.AuthError("Entre com a conta Google.");
            if (payload == null || payload.trim().isEmpty()) {
                throw new OAuthFlow.AuthError("Nada para sincronizar.");
            }
            JSONObject j = new JSONObject(payload);
            boolean force = j.optBoolean("force", false);
            if (!force && !payloadHasData(j)) {
                throw new OAuthFlow.AuthError("A base deste aparelho está vazia; nada foi enviado.");
            }
            String deviceId = j.optString("deviceId", "");
            DriveApi.UploadResult uploaded = drive().upload(deviceId, payload);
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("fileId", uploaded.fileId);
            o.put("name", uploaded.name);
            o.put("backedUpAt", uploaded.modifiedTime);
            return o.toString();
        } catch (Exception e) {
            return error(message(e));
        }
    }

    /** Exclusão total explícita ("Iniciar novo caderno"). */
    String resetCloud(String payload) {
        try {
            OAuthFlow f = oauth();
            if (!f.hasSession()) throw new OAuthFlow.AuthError("Entre com a conta Google.");
            if (payload == null || payload.trim().isEmpty()) {
                throw new OAuthFlow.AuthError("Backup em formato inválido.");
            }
            JSONObject j = new JSONObject(payload);
            String deviceId = j.optString("deviceId", "");
            drive().deleteAll();
            DriveApi.UploadResult uploaded = drive().upload(deviceId, payload);
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("fileId", uploaded.fileId);
            o.put("name", uploaded.name);
            o.put("backedUpAt", uploaded.modifiedTime);
            return o.toString();
        } catch (Exception e) {
            return error(message(e));
        }
    }

    private JSONObject signedInObject(String email) throws Exception {
        JSONObject o = new JSONObject();
        o.put("ok", true);
        o.put("configured", true);
        o.put("signedIn", true);
        o.put("email", email == null ? "" : email);
        return o;
    }

    private String signedIn(String email) {
        try {
            return signedInObject(email).toString();
        } catch (Exception e) {
            return error(message(e));
        }
    }

    private static String error(String message) {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", false);
            o.put("error", message == null || message.trim().isEmpty()
                    ? "Falha inesperada na sincronização." : message);
            return o.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"Falha inesperada na sincronização.\"}";
        }
    }

    /**
     * Falha de login nunca significa "nuvem não configurada": o cliente OAuth
     * é fixo no aplicativo. Preservar configured=true evita que a interface
     * troque a mensagem real (cancelamento, SHA-1, rede) por um aviso de
     * configuração ausente.
     */
    private static String loginError(String message) {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", false);
            o.put("configured", true);
            o.put("signedIn", false);
            o.put("error", message == null || message.trim().isEmpty()
                    ? "Login não concluído. Tente novamente." : message);
            return o.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"configured\":true,\"signedIn\":false,"
                    + "\"error\":\"Login não concluído. Tente novamente.\"}";
        }
    }

    private static String message(Exception e) {
        if (e instanceof UnknownHostException || e instanceof SocketTimeoutException) {
            return "Sem conexão com a internet. Verifique a rede e tente de novo.";
        }
        String m = e.getMessage();
        return (m == null || m.trim().isEmpty()) ? "Falha inesperada na sincronização." : m;
    }

    /**
     * v1 do Horizonte: ops não vazias. O tamanho em bytes nunca é sinal de
     * "tem dados" (regra 5.9.1).
     */
    private static boolean payloadHasData(JSONObject p) {
        if (p == null) return false;
        JSONArray ops = p.optJSONArray("ops");
        return ops != null && ops.length() > 0;
    }

    private void toast(final String text) {
        main.post(() -> {
            try {
                Toast.makeText(ctx, text, Toast.LENGTH_SHORT).show();
            } catch (Exception ignored) {}
        });
    }
}

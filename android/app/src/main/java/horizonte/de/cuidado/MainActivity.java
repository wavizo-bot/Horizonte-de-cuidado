package horizonte.de.cuidado;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.ScriptHandler;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.util.Collections;

/**
 * Host Android do Horizonte de Cuidado. Carrega o MESMO build web de docs/app
 * (empacotado em assets/app) dentro de um WebView nativo, servido por
 * WebViewAssetLoader em uma origem https estável para o localStorage e para a
 * bridge. A ponte HostBridge implementa o contrato horizonteHost do MSIX.
 *
 * Edge-to-edge (regra A7): WindowInsets de status, navegação, cutout e IME são
 * aplicados no contêiner nativo; o teclado não cobre os formulários.
 */
public class MainActivity extends Activity {

    static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String START_URL = ORIGIN + "/app/index.html";
    private static final String TAG = "HorizonteMain";

    private WebView webView;
    private HostBridge bridge;
    private FrameLayout root;
    private ProgressBar loading;
    private ScriptHandler scriptHandler;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        window.setBackgroundDrawable(new ColorDrawable(Color.parseColor("#F7F5EE")));
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(Color.TRANSPARENT);
        // Abaixo do Android 8.1 o ícone da barra de navegação é só branco:
        // fundo verde da marca garante contraste. Do 9 em diante, barra clara.
        window.setNavigationBarColor(Build.VERSION.SDK_INT < 27
                ? Color.parseColor("#174A3A") : Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams attrs = window.getAttributes();
            attrs.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(attrs);
        }
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(true);
        controller.setAppearanceLightNavigationBars(Build.VERSION.SDK_INT >= 27);

        // Inspeção de layout e testes automatizados somente no build debug.
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#F7F5EE"));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#F7F5EE"));
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        loading = new ProgressBar(this);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT);
        lp.gravity = Gravity.CENTER;
        root.addView(loading, lp);

        setContentView(root);

        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars()
                            | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            int bottom = Math.max(bars.bottom, ime.bottom);
            v.setPadding(bars.left, bars.top, bars.right, bottom);
            return insets;
        });
        ViewCompat.requestApplyInsets(root);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setSaveFormData(false);
        s.setGeolocationEnabled(false);

        // /app/ -> assets/app/ (o build web de docs/app), sem misturar o
        // bundle com bridge.js.
        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/app/", new AppAssetsHandler(this))
                .build();

        bridge = new HostBridge(this, webView);
        webView.addJavascriptInterface(bridge, "HorizonteAndroid");

        String bridgeScript = bridge.bridgeScript();
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            scriptHandler = WebViewCompat.addDocumentStartJavaScript(
                    webView, bridgeScript, Collections.singleton(ORIGIN));
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(Uri.parse(url));
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                    view.evaluateJavascript(bridgeScript, null);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                loading.setVisibility(View.GONE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    Log.w(TAG, "Falha ao carregar " + request.getUrl() + ": " + error.getDescription());
                    loading.setVisibility(View.GONE);
                    showErrorPage();
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (newProgress >= 100) loading.setVisibility(View.GONE);
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                // O app não usa câmera, microfone nem localização.
                request.deny();
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin,
                                                           GeolocationPermissions.Callback callback) {
                callback.invoke(origin, false, false);
            }
        });

        String start = START_URL;
        if (savedInstanceState != null) {
            String saved = savedInstanceState.getString("url");
            if (saved != null && saved.startsWith(ORIGIN + "/")) start = saved;
        }
        webView.loadUrl(start);
    }

    /**
     * Links internos (leis, páginas do app) ficam no WebView. WhatsApp, SMS,
     * telefone, e-mail e sites externos abrem no app/navegador do sistema.
     * Nada de navegar fora da origem local dentro do WebView.
     */
    private boolean handleUrl(Uri uri) {
        if (uri == null) return true;
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if ("https".equals(scheme) && "appassets.androidplatform.net".equals(host)) {
            return false;
        }
        if ("about".equals(scheme)) return false;
        if ("http".equals(scheme) || "https".equals(scheme)
                || "mailto".equals(scheme) || "tel".equals(scheme)
                || "sms".equals(scheme) || "whatsapp".equals(scheme)) {
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, uri);
                i.addCategory(Intent.CATEGORY_BROWSABLE);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
            } catch (Exception e) {
                Toast.makeText(this, "Nenhum aplicativo disponível para abrir este link.",
                        Toast.LENGTH_LONG).show();
            }
            return true;
        }
        return true;
    }

    private void showErrorPage() {
        String html = "<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<style>body{margin:0;min-height:100vh;display:grid;place-items:center;"
                + "background:#F7F5EE;color:#2F4A3C;font-family:system-ui,sans-serif;"
                + "padding:24px;text-align:center}h1{font-family:Georgia,serif;color:#174A3A;"
                + "font-size:24px}a{display:inline-block;margin-top:16px;background:#174A3A;"
                + "color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none}"
                + "</style></head><body><div><h1>Não foi possível abrir o Horizonte</h1>"
                + "<p>Feche o app e abra novamente. Se o problema continuar, reinstale o aplicativo.</p>"
                + "<a href=\"" + START_URL + "\">Tentar novamente</a></div></body></html>";
        webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        final WebView view = webView;
        if (view == null) {
            super.onBackPressed();
            return;
        }
        // O app web decide primeiro: painel de navegação aberto ou modal no
        // topo consomem o Voltar. Só depois o histórico e, por fim, a saída.
        view.evaluateJavascript(
                "(function(){try{return window.__horizonteHandleBack"
                        + "?window.__horizonteHandleBack()===true:false}catch(e){return false}})()",
                handled -> {
                    if ("true".equals(handled)) return;
                    if (webView != null && webView.canGoBack()) {
                        webView.goBack();
                    } else {
                        finish();
                    }
                });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (bridge != null) bridge.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions,
                                           @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (bridge != null) {
            bridge.onRequestPermissionsResult(requestCode, permissions, grantResults);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null && webView.getUrl() != null) {
            outState.putString("url", webView.getUrl());
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (scriptHandler != null) {
            scriptHandler.remove();
            scriptHandler = null;
        }
        if (bridge != null) {
            bridge.shutdown();
            bridge = null;
        }
        if (webView != null) {
            root.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}

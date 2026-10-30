package horizonte.de.cuidado;

import android.content.Context;
import android.util.Log;
import android.webkit.WebResourceResponse;

import androidx.webkit.WebViewAssetLoader;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Serve o build web de docs/app (copiado para assets/app) em /app/.
 *
 * O AssetsPathHandler público do androidx.webkit só mapeia a URL direto na
 * raiz de assets; aqui prefixamos "app/" para manter o bundle web separado de
 * bridge.js. Qualquer caminho fora de /app/ ou com ".."
 * é recusado.
 */
final class AppAssetsHandler implements WebViewAssetLoader.PathHandler {

    private final Context context;

    AppAssetsHandler(Context context) {
        this.context = context.getApplicationContext();
    }

    @Override
    public WebResourceResponse handle(String path) {
        if (path == null) return null;
        int cut = path.indexOf('?');
        if (cut >= 0) path = path.substring(0, cut);
        cut = path.indexOf('#');
        if (cut >= 0) path = path.substring(0, cut);

        // O WebViewAssetLoader já removeu o prefixo /app/ registrado; aqui o
        // caminho chega como "index.html", "assets/app.js" etc.
        String relative = path;
        while (relative.startsWith("/")) relative = relative.substring(1);
        if (relative.isEmpty() || relative.endsWith("/")) relative += "index.html";
        if (relative.indexOf('\0') >= 0
                || relative.indexOf('\\') >= 0
                || relative.contains("..")) {
            return null;
        }

        try {
            InputStream in = context.getAssets().open("app/" + relative);
            String mime = mimeType(relative);
            WebResourceResponse response = new WebResourceResponse(
                    mime, isText(mime) ? "UTF-8" : null, in);
            Map<String, String> headers = new HashMap<>();
            // O APK é a fonte da verdade: nunca servir bundle antigo do cache.
            headers.put("Cache-Control", "no-cache");
            response.setResponseHeaders(headers);
            return response;
        } catch (IOException e) {
            Log.w("HorizonteAssets", "asset ausente: app/" + relative, e);
            return null;
        }
    }

    private static boolean isText(String mime) {
        return mime.startsWith("text/")
                || mime.equals("application/json")
                || mime.equals("application/manifest+json")
                || mime.equals("application/xml")
                || mime.equals("image/svg+xml")
                || mime.equals("application/javascript");
    }

    private static String mimeType(String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json") || lower.endsWith(".map")) return "application/json";
        if (lower.endsWith(".webmanifest")) return "application/manifest+json";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".ico")) return "image/x-icon";
        if (lower.endsWith(".ttf")) return "font/ttf";
        if (lower.endsWith(".otf")) return "font/otf";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".txt")) return "text/plain";
        if (lower.endsWith(".xml")) return "application/xml";
        if (lower.endsWith(".wasm")) return "application/wasm";
        String guessed = java.net.URLConnection.guessContentTypeFromName(lower);
        return guessed == null ? "application/octet-stream" : guessed;
    }
}

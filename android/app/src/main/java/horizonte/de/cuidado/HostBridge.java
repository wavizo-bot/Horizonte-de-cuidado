package horizonte.de.cuidado;

import android.Manifest;
import android.annotation.TargetApi;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Ponte nativa do WebView. O JavaScript do app chama HostBridge.call via
 * addJavascriptInterface; o método devolve imediatamente e a resposta chega
 * depois em window.__horizonteResolve(id, resultado). Assim o MESMO contrato
 * do host WebView2 do MSIX (métodos que devolvem Promise) funciona no Android
 * sem fork da lógica React/TypeScript.
 *
 * Exportar/importar e imprimir são plugins nativos (regra A6): MediaStore /
 * Storage Access Framework e PrintManager, nunca download de Blob nem
 * window.print do WebView.
 */
final class HostBridge {

    private static final String TAG = "HorizonteHost";
    private static final int REQ_OPEN = 7201;
    private static final int REQ_STORAGE = 7202;
    private static final String FOLDER = "Horizonte de Cuidado";
    private static final long MAX_IMPORT_BYTES = 25L * 1024L * 1024L;

    private final Activity activity;
    private final WebView webView;
    private final DriveHost drive;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final Handler main = new Handler(Looper.getMainLooper());

    private int pendingOpenId = -1;
    private int pendingSaveId = -1;
    private String pendingSaveName;
    private String pendingSaveMime;
    private byte[] pendingSaveBytes;

    HostBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        this.drive = new DriveHost(activity);
    }

    @JavascriptInterface
    public String call(String request) {
        try {
            JSONObject req = new JSONObject(request);
            final int id = req.optInt("id", 0);
            final String method = req.optString("method", "");
            final JSONArray args = req.optJSONArray("args");
            pool.execute(() -> dispatch(id, method, args));
            return "ok";
        } catch (Exception e) {
            return "error";
        }
    }

    private void dispatch(int id, String method, JSONArray args) {
        try {
            switch (method) {
                case "GetAppVersion":
                    reply(id, versionName());
                    break;
                case "SaveTextFile":
                    saveTextFile(id, arg(args, 0), arg(args, 1));
                    break;
                case "OpenTextFile":
                    openTextFile(id);
                    break;
                case "Quit":
                    main.post(() -> {
                        try { activity.finishAndRemoveTask(); } catch (Exception ignored) {}
                    });
                    reply(id, "closing");
                    break;
                case "Print":
                    printPage();
                    reply(id, "ok");
                    break;
                case "OpenExternal":
                    openExternal(arg(args, 0));
                    reply(id, "ok");
                    break;
                case "DriveGetState":
                    reply(id, drive.getState());
                    break;
                case "DriveLogin":
                    reply(id, drive.login());
                    break;
                case "DriveLogout":
                    reply(id, drive.logout());
                    break;
                case "DriveCheckRemote":
                    reply(id, drive.checkRemote());
                    break;
                case "DriveRestoreFile":
                    reply(id, drive.restoreFile(arg(args, 0)));
                    break;
                case "DriveBackup":
                    reply(id, drive.backup(arg(args, 0)));
                    break;
                case "DriveResetCloud":
                    reply(id, drive.resetCloud(arg(args, 0)));
                    break;
                default:
                    reply(id, null);
            }
        } catch (Throwable e) {
            // Throwable, não só Exception: um NoClassDefFoundError/NoSuchMethod
            // no release não pode deixar a Promise do WebView pendurada.
            Log.e(TAG, "Falha em " + method, e);
            if ("DriveLogin".equals(method)) {
                reply(id, DriveHost.loginError("Falha interna no login. Tente novamente."));
            } else {
                reply(id, null);
            }
        }
    }

    String bridgeScript() {
        try (InputStream in = activity.getAssets().open("bridge.js")) {
            return Http.readAll(in);
        } catch (Exception e) {
            Log.e(TAG, "bridge.js ausente", e);
            return "";
        }
    }

    void onActivityResult(int requestCode, int resultCode, Intent data) {
        // O login Google nativo também volta por Activity Result.
        drive.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_OPEN) return;
        final int id;
        synchronized (this) {
            id = pendingOpenId;
            pendingOpenId = -1;
        }
        if (id <= 0) return;
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            reply(id, "");
            return;
        }
        final Uri uri = data.getData();
        pool.execute(() -> reply(id, readText(uri)));
    }

    void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode != REQ_STORAGE) return;
        final int id;
        final String name;
        final String mime;
        final byte[] bytes;
        synchronized (this) {
            id = pendingSaveId;
            name = pendingSaveName;
            mime = pendingSaveMime;
            bytes = pendingSaveBytes;
            pendingSaveId = -1;
            pendingSaveName = null;
            pendingSaveMime = null;
            pendingSaveBytes = null;
        }
        if (id <= 0) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            pool.execute(() -> reply(id, saveLegacy(name, mime, bytes)));
        } else {
            reply(id, "");
            toast("Permissão negada. Autorize o armazenamento para salvar em Downloads.");
        }
    }

    void shutdown() {
        pool.shutdownNow();
    }

    /* ------------------------------------------------------------- arquivos -- */

    private void saveTextFile(int id, String defaultName, String content) {
        final String name = sanitize(defaultName);
        final String mime = mimeFor(name);
        final byte[] bytes = (content == null ? "" : content).getBytes(StandardCharsets.UTF_8);

        if (Build.VERSION.SDK_INT >= 29) {
            reply(id, saveModern(name, mime, bytes));
            return;
        }
        if (activity.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                == PackageManager.PERMISSION_GRANTED) {
            reply(id, saveLegacy(name, mime, bytes));
            return;
        }
        synchronized (this) {
            if (pendingSaveId > 0) {
                reply(id, "");
                return;
            }
            pendingSaveId = id;
            pendingSaveName = name;
            pendingSaveMime = mime;
            pendingSaveBytes = bytes;
        }
        main.post(() -> {
            try {
                activity.requestPermissions(
                        new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
            } catch (Exception e) {
                final int pending;
                synchronized (HostBridge.this) {
                    pending = pendingSaveId;
                    pendingSaveId = -1;
                }
                reply(pending, "");
            }
        });
    }

    @TargetApi(Build.VERSION_CODES.Q)
    private String saveModern(String name, String mime, byte[] bytes) {
        ContentResolver cr = activity.getContentResolver();
        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        v.put(MediaStore.MediaColumns.RELATIVE_PATH,
                Environment.DIRECTORY_DOWNLOADS + "/" + FOLDER);
        v.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri uri = null;
        try {
            uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new IllegalStateException("MediaStore recusou o arquivo");
            try (OutputStream os = cr.openOutputStream(uri)) {
                if (os == null) throw new IllegalStateException("sem stream de escrita");
                os.write(bytes);
                os.flush();
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
            cr.update(uri, done, null, null);
            toast("Salvo em Downloads/" + FOLDER + "/" + name);
            return name;
        } catch (Exception e) {
            if (uri != null) {
                try { cr.delete(uri, null, null); } catch (Exception ignored) {}
            }
            toast("Não foi possível salvar em Downloads: " + e.getMessage());
            return "";
        }
    }

    @SuppressWarnings("deprecation")
    private String saveLegacy(String name, String mime, byte[] bytes) {
        try {
            File dir = new File(Environment.getExternalStoragePublicDirectory(
                    Environment.DIRECTORY_DOWNLOADS), FOLDER);
            if (!dir.exists() && !dir.mkdirs()) {
                throw new IllegalStateException("não foi possível criar a pasta Downloads/" + FOLDER);
            }
            File file = unique(dir, name);
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(bytes);
            }
            MediaScannerConnection.scanFile(activity,
                    new String[]{file.getAbsolutePath()}, new String[]{mime}, null);
            toast("Salvo em Downloads/" + FOLDER + "/" + file.getName());
            return file.getName();
        } catch (Exception e) {
            toast("Não foi possível salvar em Downloads: " + e.getMessage());
            return "";
        }
    }

    private void openTextFile(int id) {
        main.post(() -> {
            synchronized (HostBridge.this) {
                if (pendingOpenId > 0) {
                    reply(id, "");
                    return;
                }
                pendingOpenId = id;
            }
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                    "application/json",
                    "text/plain",
                    "text/csv",
                    "text/comma-separated-values",
                    "text/tab-separated-values",
                    "application/octet-stream"
            });
            try {
                activity.startActivityForResult(i, REQ_OPEN);
            } catch (Exception e) {
                synchronized (HostBridge.this) { pendingOpenId = -1; }
                reply(id, "");
            }
        });
    }

    private String readText(Uri uri) {
        try (InputStream in = activity.getContentResolver().openInputStream(uri)) {
            if (in == null) return "";
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            long total = 0;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > MAX_IMPORT_BYTES) {
                    toast("Arquivo muito grande para importar.");
                    return "";
                }
                out.write(buf, 0, n);
            }
            String text = new String(out.toByteArray(), StandardCharsets.UTF_8);
            if (!text.isEmpty() && text.charAt(0) == '\uFEFF') {
                text = text.substring(1);
            }
            return text;
        } catch (Exception e) {
            toast("Não foi possível ler o arquivo: " + e.getMessage());
            return "";
        }
    }

    /* -------------------------------------------------------------- sistema -- */

    private void printPage() {
        main.post(() -> {
            try {
                PrintManager pm = (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
                if (pm == null) {
                    toast("Impressão não disponível neste aparelho.");
                    return;
                }
                String job = "Horizonte de Cuidado";
                PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(job);
                PrintAttributes attrs = new PrintAttributes.Builder()
                        .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                        .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                        .build();
                pm.print(job, adapter, attrs);
            } catch (Exception e) {
                toast("Não foi possível abrir a impressão: " + e.getMessage());
            }
        });
    }

    private void openExternal(String url) {
        if (url == null || url.trim().isEmpty()) return;
        main.post(() -> {
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                i.addCategory(Intent.CATEGORY_BROWSABLE);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(i);
            } catch (Exception e) {
                toast("Nenhum aplicativo disponível para abrir este link.");
            }
        });
    }

    private String versionName() {
        try {
            String v = activity.getPackageManager()
                    .getPackageInfo(activity.getPackageName(), 0).versionName;
            return v == null ? "" : v;
        } catch (Exception e) {
            return "";
        }
    }

    /* ---------------------------------------------------------------- infra -- */

    private void reply(int id, String result) {
        if (id <= 0) return;
        // JSONObject.quote não escapa U+2028/U+2029; WebViews antigos (Android 7)
        // quebram o literal JavaScript se o texto do usuário contiver esses
        // caracteres. Escapamos antes de avaliar.
        final String value = result == null ? "null" : JSONObject.quote(result)
                .replace("\u2028", "\\u2028")
                .replace("\u2029", "\\u2029");
        main.post(() -> {
            String js = "window.__horizonteResolve(" + id + "," + value + ");";
            try {
                webView.evaluateJavascript(js, null);
            } catch (Exception ignored) {}
        });
    }

    private void toast(final String text) {
        main.post(() -> {
            try {
                Toast.makeText(activity, text, Toast.LENGTH_LONG).show();
            } catch (Exception ignored) {}
        });
    }

    private static String arg(JSONArray args, int index) {
        if (args == null) return "";
        Object v = args.opt(index);
        return v == null || v == JSONObject.NULL ? "" : String.valueOf(v);
    }

    private static String mimeFor(String name) {
        String lower = name == null ? "" : name.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".csv")) return "text/csv";
        if (lower.endsWith(".tsv")) return "text/tab-separated-values";
        if (lower.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    private static String sanitize(String raw) {
        String name = raw == null ? "horizonte.txt" : raw;
        name = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (name.isEmpty()) name = "horizonte.txt";
        if (name.length() > 120) {
            int dot = name.lastIndexOf('.');
            String ext = dot > 0 ? name.substring(dot) : "";
            name = name.substring(0, Math.max(1, 120 - ext.length())) + ext;
        }
        return name;
    }

    private static File unique(File dir, String name) {
        File f = new File(dir, name);
        if (!f.exists()) return f;
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 2; i < 1000; i++) {
            f = new File(dir, base + " (" + i + ")" + ext);
            if (!f.exists()) return f;
        }
        return new File(dir, base + "-" + System.currentTimeMillis() + ext);
    }
}

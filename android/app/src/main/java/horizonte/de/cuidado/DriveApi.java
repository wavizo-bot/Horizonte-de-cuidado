package horizonte.de.cuidado;

import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;

/**
 * Google Drive v3, espaço appDataFolder. Mesmo modelo do app Windows:
 * um arquivo por dispositivo (horizonte-ops-<deviceId>.json) e o legado
 * horizonte-backup.json. Só REST: nenhuma biblioteca do Google entra no APK.
 *
 * O tamanho do arquivo NUNCA é critério de validade nem de escolha: o
 * sync.ts valida esquema/checksum de cada candidato e mescla todos.
 */
final class DriveApi {

    static final String LEGACY_NAME = "horizonte-backup.json";
    private static final String FILES = "https://www.googleapis.com/drive/v3/files";
    private static final String UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

    static final class FileInfo {
        final String id;
        final String name;
        final long modifiedTime;
        final long size;

        FileInfo(String id, String name, long modifiedTime, long size) {
            this.id = id;
            this.name = name;
            this.modifiedTime = modifiedTime;
            this.size = size;
        }
    }

    static final class UploadResult {
        final String fileId;
        final String name;
        final long modifiedTime;

        UploadResult(String fileId, String name, long modifiedTime) {
            this.fileId = fileId;
            this.name = name;
            this.modifiedTime = modifiedTime;
        }
    }

    private final OAuthFlow auth;

    DriveApi(OAuthFlow auth) {
        this.auth = auth;
    }

    /** Lista TODOS os backups (legado + por dispositivo), mais recentes antes. */
    List<FileInfo> list() throws Exception {
        String url = Uri.parse(FILES).buildUpon()
                .appendQueryParameter("spaces", "appDataFolder")
                .appendQueryParameter("q", "trashed = false")
                .appendQueryParameter("fields", "files(id,name,modifiedTime,size)")
                .appendQueryParameter("orderBy", "modifiedTime desc")
                .appendQueryParameter("pageSize", "100")
                .build().toString();
        Http.Resp r = authed("GET", url, null, null);
        List<FileInfo> out = new ArrayList<>();
        JSONObject j = new JSONObject(r.body);
        JSONArray arr = j.optJSONArray("files");
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject f = arr.optJSONObject(i);
            if (f == null) continue;
            String name = f.optString("name", "");
            if (name.isEmpty()) continue;
            if (!name.startsWith("horizonte-")) continue;
            out.add(new FileInfo(
                    f.optString("id", ""),
                    name,
                    parseTime(f.optString("modifiedTime", "")),
                    f.optLong("size", 0)));
        }
        return out;
    }

    FileInfo findByName(String name) throws Exception {
        for (FileInfo f : list()) {
            if (f.name.equalsIgnoreCase(name)) return f;
        }
        return null;
    }

    /** Cria ou atualiza o arquivo deste dispositivo e devolve id + horário do servidor. */
    UploadResult upload(String deviceId, String payload) throws Exception {
        String name = backupName(deviceId);
        FileInfo current = findByName(name);
        String query = "?uploadType=media&fields=id,modifiedTime";
        String fileId;
        long serverMs = 0;
        if (current != null) {
            fileId = current.id;
            String url = UPLOAD + "/" + Uri.encode(current.id) + query;
            Http.Resp r = authed("PATCH", url, "application/json; charset=UTF-8",
                    payload.getBytes(StandardCharsets.UTF_8));
            JSONObject j = new JSONObject(r.body);
            fileId = j.optString("id", fileId);
            serverMs = parseTime(j.optString("modifiedTime", ""));
        } else {
            String boundary = "horizonte_" + UUID.randomUUID().toString().replace("-", "");
            String meta = "{\"name\":\"" + name + "\",\"parents\":[\"appDataFolder\"]}";
            String head = "--" + boundary + "\r\n"
                    + "Content-Type: application/json; charset=UTF-8\r\n\r\n"
                    + meta + "\r\n"
                    + "--" + boundary + "\r\n"
                    + "Content-Type: application/json; charset=UTF-8\r\n\r\n";
            byte[] tail = ("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            out.write(head.getBytes(StandardCharsets.UTF_8));
            out.write(payload.getBytes(StandardCharsets.UTF_8));
            out.write(tail);
            String url = UPLOAD + "?uploadType=multipart&fields=id,modifiedTime";
            Http.Resp r = authed("POST", url,
                    "multipart/related; boundary=\"" + boundary + "\"", out.toByteArray());
            JSONObject j = new JSONObject(r.body);
            fileId = j.optString("id", "");
            serverMs = parseTime(j.optString("modifiedTime", ""));
        }
        if (serverMs == 0 && fileId != null && !fileId.isEmpty()) {
            serverMs = getModifiedTime(fileId);
        }
        if (serverMs == 0) serverMs = System.currentTimeMillis();
        return new UploadResult(fileId, name, serverMs);
    }

    String download(String fileId) throws Exception {
        if (fileId == null || fileId.isEmpty()) {
            List<FileInfo> all = list();
            if (all.isEmpty()) {
                throw new OAuthFlow.AuthError("Nenhum backup no Google Drive desta conta.");
            }
            fileId = all.get(0).id;
        }
        String url = Uri.parse(FILES + "/" + Uri.encode(fileId)).buildUpon()
                .appendQueryParameter("alt", "media")
                .build().toString();
        Http.Resp r = authed("GET", url, null, null);
        if (r.body == null || r.body.isEmpty()) {
            throw new OAuthFlow.AuthError("O backup no Google Drive está vazio.");
        }
        return r.body;
    }

    /** Exclusão total: apaga todos os backups (legado e por dispositivo). */
    void deleteAll() throws Exception {
        for (FileInfo f : list()) {
            if (f.id == null || f.id.isEmpty()) continue;
            String url = FILES + "/" + Uri.encode(f.id);
            Http.Resp r = Http.send("DELETE", url, null, null, auth.accessToken());
            if (r.code == 401) {
                auth.invalidateAccessToken();
                r = Http.send("DELETE", url, null, null, auth.accessToken());
            }
            if (!r.ok() && r.code != 404) {
                throw new OAuthFlow.AuthError(friendlyError(r));
            }
        }
    }

    private long getModifiedTime(String fileId) {
        try {
            String url = Uri.parse(FILES + "/" + Uri.encode(fileId)).buildUpon()
                    .appendQueryParameter("fields", "modifiedTime")
                    .build().toString();
            Http.Resp r = authed("GET", url, null, null);
            return parseTime(new JSONObject(r.body).optString("modifiedTime", ""));
        } catch (Exception e) {
            return 0;
        }
    }

    private Http.Resp authed(String method, String url, String contentType, byte[] body)
            throws Exception {
        String token = auth.accessToken();
        Http.Resp r = Http.send(method, url, contentType, body, token);
        if (r.code == 401) {
            auth.invalidateAccessToken();
            token = auth.accessToken();
            r = Http.send(method, url, contentType, body, token);
        }
        if (!r.ok()) {
            throw new OAuthFlow.AuthError(friendlyError(r));
        }
        return r;
    }

    private static String friendlyError(Http.Resp r) {
        String detail = OAuthFlow.jsonError(r.body);
        if (r.code == 401) {
            return "A autorização do Google expirou. Entre novamente com a conta Google.";
        }
        if (r.code == 403) {
            return "O Google Drive não liberou o acesso para esta conta. Saia e entre "
                    + "novamente aceitando a permissão do Drive. (" + detail + ")";
        }
        if (r.code == 404) {
            return "O backup não está mais no Google Drive. Sincronize novamente pelo app.";
        }
        if (r.code == 429) {
            return "Muitas sincronizações em pouco tempo. Aguarde um minuto e tente de novo.";
        }
        if (r.code >= 500) {
            return "O Google Drive está instável agora (HTTP " + r.code + "). Tente mais tarde.";
        }
        return "Falha no Google Drive (HTTP " + r.code + "): " + detail;
    }

    static String backupName(String deviceId) {
        if (deviceId == null || deviceId.trim().isEmpty()) return LEGACY_NAME;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < deviceId.length() && sb.length() < 64; i++) {
            char c = deviceId.charAt(i);
            if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                    (c >= '0' && c <= '9') || c == '-' || c == '_') {
                sb.append(c);
            }
        }
        if (sb.length() == 0) return LEGACY_NAME;
        return "horizonte-ops-" + sb + ".json";
    }

    static long parseTime(String iso) {
        if (iso == null || iso.isEmpty()) return 0;
        String[] patterns = {
                "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                "yyyy-MM-dd'T'HH:mm:ss'Z'",
                "yyyy-MM-dd'T'HH:mm:ss.SSSXXX"
        };
        for (String p : patterns) {
            try {
                SimpleDateFormat f = new SimpleDateFormat(p, Locale.US);
                f.setTimeZone(TimeZone.getTimeZone("UTC"));
                java.util.Date d = f.parse(iso);
                if (d != null) return d.getTime();
            } catch (Exception ignored) {}
        }
        return 0;
    }
}

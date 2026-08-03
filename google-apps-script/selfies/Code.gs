const SELFIE_SERVICE_CONFIG_ = Object.freeze({
  folderId: "1oEclkjctnSxAmuoFc8OxNMus5YwKoyIL",
  databaseUrl: "https://github-737ec-default-rtdb.firebaseio.com",
  appRoot: "gestao-folgas/v2",
  maxImageBytes: 700000,
});

const CLOCK_TYPES_ = Object.freeze([
  "ENTRADA",
  "SAIDA_INTERVALO",
  "RETORNO_INTERVALO",
  "SEM_DESCANSO",
  "SAIDA_FINAL",
]);

function doGet() {
  return jsonResponse_({
    ok: true,
    service: "selfies-ponto-drive",
    storage: "google-drive",
  });
}

function doPost(event) {
  try {
    const payload = JSON.parse(
      String(event && event.postData && event.postData.contents || "{}"),
    );
    assert_(payload.action === "uploadClockSelfie", "Ação inválida.");

    const token = String(payload.idToken || "");
    const uid = firebaseUid_(token);
    const profile = firebaseProfile_(uid, token);
    assert_(profile && profile.Ativo !== false, "Usuário inativo.");
    assert_(profile.FuncionarioID, "Usuário sem funcionário vinculado.");

    const requestId = String(payload.requestId || "").trim();
    const day = String(payload.day || "");
    const type = String(payload.clockType || "").toUpperCase();
    assert_(
      /^[A-Za-z0-9-]{16,100}$/.test(requestId),
      "Identificador da marcação inválido.",
    );
    assert_(/^\d{4}-\d{2}-\d{2}$/.test(day), "Data da marcação inválida.");
    assert_(CLOCK_TYPES_.indexOf(type) >= 0, "Tipo de marcação inválido.");

    const image = decodeSelfie_(payload.selfieDataUrl);
    const destination = destinationFolder_(profile, day);
    const fileName = [
      day,
      safeName_(profile.Nome || profile.Email || profile.FuncionarioID),
      type,
      requestId,
    ].join("__") + ".jpg";

    const existing = destination.getFilesByName(fileName);
    const file = existing.hasNext()
      ? existing.next()
      : destination.createFile(
          Utilities.newBlob(image, "image/jpeg", fileName),
        );
    const fileId = file.getId();

    return jsonResponse_({
      ok: true,
      fileId: fileId,
      fileUrl: "https://drive.google.com/file/d/" + fileId + "/view",
      fileName: fileName,
      uploadedAt: new Date().toISOString(),
    });
  } catch (error) {
    return jsonResponse_({
      ok: false,
      error: String(error && error.message || error || "Falha no upload."),
    });
  }
}

function firebaseUid_(token) {
  assert_(token, "Sessão ausente.");
  const parts = token.split(".");
  assert_(parts.length === 3, "Sessão inválida.");
  try {
    const json = Utilities.newBlob(
      Utilities.base64DecodeWebSafe(parts[1]),
    ).getDataAsString("UTF-8");
    const claims = JSON.parse(json);
    const uid = String(claims.sub || claims.user_id || "");
    assert_(uid, "Sessão sem identificação.");
    return uid;
  } catch (error) {
    throw new Error("Não foi possível identificar a sessão.");
  }
}

function firebaseProfile_(uid, token) {
  const url = [
    SELFIE_SERVICE_CONFIG_.databaseUrl,
    SELFIE_SERVICE_CONFIG_.appRoot,
    "access",
    encodeURIComponent(uid) + ".json?auth=" + encodeURIComponent(token),
  ].join("/");
  const response = UrlFetchApp.fetch(url, {
    method: "get",
    muteHttpExceptions: true,
  });
  assert_(
    response.getResponseCode() === 200,
    "Sessão expirada ou sem permissão.",
  );
  const profile = JSON.parse(response.getContentText() || "null");
  assert_(
    profile && String(profile.UsuarioID || "") === uid,
    "Perfil não autorizado.",
  );
  return profile;
}

function decodeSelfie_(dataUrl) {
  const match = String(dataUrl || "").match(
    /^data:image\/jpeg;base64,([A-Za-z0-9+/=\s]+)$/,
  );
  assert_(match, "Capture uma selfie JPG válida.");
  const bytes = Utilities.base64Decode(match[1].replace(/\s/g, ""));
  assert_(bytes.length > 1000, "A selfie está vazia.");
  assert_(
    bytes.length <= SELFIE_SERVICE_CONFIG_.maxImageBytes,
    "A selfie ultrapassa o limite permitido.",
  );
  return bytes;
}

function destinationFolder_(profile, day) {
  const storeName = safeName_(
    profile.NomeLoja || profile.LojaID || "Sem loja",
  );
  const cache = CacheService.getScriptCache();
  const cacheKey = [
    "selfie-folder",
    day.slice(0, 7),
    storeName,
  ].join(":");
  const cachedId = cache.get(cacheKey);
  if (cachedId) {
    try {
      return DriveApp.getFolderById(cachedId);
    } catch (ignored) {
      cache.remove(cacheKey);
    }
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const lockedCachedId = cache.get(cacheKey);
    if (lockedCachedId) {
      try {
        return DriveApp.getFolderById(lockedCachedId);
      } catch (ignored) {
        cache.remove(cacheKey);
      }
    }
    const root = DriveApp.getFolderById(SELFIE_SERVICE_CONFIG_.folderId);
    const year = childFolder_(root, day.slice(0, 4));
    const month = childFolder_(year, day.slice(0, 7));
    const destination = childFolder_(month, storeName);
    cache.put(cacheKey, destination.getId(), 21600);
    return destination;
  } finally {
    lock.releaseLock();
  }
}

function childFolder_(parent, name) {
  const matches = parent.getFoldersByName(name);
  return matches.hasNext() ? matches.next() : parent.createFolder(name);
}

function safeName_(value) {
  return String(value || "Sem nome")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "Sem-nome";
}

function assert_(condition, message) {
  if (!condition) throw new Error(message);
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

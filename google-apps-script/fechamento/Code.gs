const CLOSING_SERVICE_CONFIG_ = Object.freeze({
  folderId: "1oEclkjctnSxAmuoFc8OxNMus5YwKoyIL",
  folderName: "Fechamento de Caixa",
  databaseUrl: "https://house190-fechamento-caixa-default-rtdb.firebaseio.com",
  maxFileBytes: 2 * 1024 * 1024,
});

function doGet() {
  return jsonResponse_({
    ok: true,
    service: "fechamento-caixa-drive",
    storage: "google-drive",
    actions: ["uploadClosingAttachment", "deleteClosingAttachment"],
  });
}

function doPost(event) {
  try {
    const payload = JSON.parse(
      String(event && event.postData && event.postData.contents || "{}"),
    );
    const action = String(payload.action || "");
    if (action === "uploadClosingAttachment") {
      return uploadClosingAttachment_(payload);
    }
    if (action === "deleteClosingAttachment") {
      return deleteClosingAttachment_(payload);
    }
    throw new Error("Ação inválida.");
  } catch (error) {
    return jsonResponse_({
      ok: false,
      error: String(error && error.message || error || "Falha no upload."),
    });
  }
}

function uploadClosingAttachment_(payload) {
  const token = String(payload.idToken || "");
  const uid = firebaseUid_(token);
  const profile = firebaseClosingProfile_(uid, token);
  assert_(profile && profile.active !== false, "Usuário inativo.");

  const requestId = String(payload.requestId || "").trim();
  const closingId = String(payload.closingId || "").trim();
  const day = String(payload.day || "");
  const store = String(payload.store || "").trim();
  const category = String(payload.category || "Comprovante").trim();
  assert_(
    /^[A-Za-z0-9-]{16,100}$/.test(requestId),
    "Identificador do arquivo inválido.",
  );
  assert_(
    /^[A-Za-z0-9_-]{8,180}$/.test(closingId),
    "Fechamento inválido.",
  );
  assert_(/^\d{4}-\d{2}-\d{2}$/.test(day), "Data do fechamento inválida.");
  assert_(store, "Loja não informada.");
  assertClosingStore_(profile, store);

  const decoded = decodeClosingFile_(payload.fileDataUrl, payload.mimeType);
  const extension = extensionForMimeType_(decoded.mimeType);
  const destination = closingDestinationFolder_(store, day);
  const fileName = [
    day,
    safeName_(store),
    safeName_(category),
    safeName_(closingId),
    requestId,
  ].join("__") + "." + extension;

  const existing = destination.getFilesByName(fileName);
  const file = existing.hasNext()
    ? existing.next()
    : destination.createFile(
        Utilities.newBlob(decoded.bytes, decoded.mimeType, fileName),
      );
  file.setDescription(JSON.stringify({
    origem: "Fechamento de Caixa House190",
    requestId: requestId,
    fechamentoId: closingId,
    loja: store,
    categoria: category,
    data: day,
    uploaderUid: uid,
    uploaderNome: String(profile.name || profile.email || uid),
  }));

  let sharedWithLink = false;
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    sharedWithLink = true;
  } catch (error) {
    sharedWithLink = false;
  }

  return jsonResponse_({
    ok: true,
    fileId: file.getId(),
    fileUrl: file.getUrl(),
    fileName: file.getName(),
    sharedWithLink: sharedWithLink,
    uploadedAt: new Date().toISOString(),
  });
}

function deleteClosingAttachment_(payload) {
  const token = String(payload.idToken || "");
  const uid = firebaseUid_(token);
  const profile = firebaseClosingProfile_(uid, token);
  assert_(profile && profile.active !== false, "Usuário inativo.");

  const fileId = String(payload.fileId || "").trim();
  assert_(fileId, "Arquivo não informado.");
  const file = DriveApp.getFileById(fileId);
  let metadata = {};
  try {
    metadata = JSON.parse(file.getDescription() || "{}");
  } catch (error) {
    metadata = {};
  }
  assert_(
    metadata.origem === "Fechamento de Caixa House190",
    "Arquivo não autorizado.",
  );
  const privileged = profile.role === "admin" || profile.role === "finance";
  assert_(
    privileged || String(metadata.uploaderUid || "") === uid,
    "Sem permissão para excluir.",
  );
  file.setTrashed(true);
  return jsonResponse_({ok: true, fileId: fileId, deleted: true});
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

function firebaseClosingProfile_(uid, token) {
  const url = [
    CLOSING_SERVICE_CONFIG_.databaseUrl,
    "users",
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
  assert_(profile, "Perfil do fechamento não autorizado.");
  return profile;
}

function assertClosingStore_(profile, store) {
  if (profile.role === "admin" || profile.role === "finance") return;
  const stores = Array.isArray(profile.stores)
    ? profile.stores
    : [profile.store].filter(Boolean);
  assert_(stores.indexOf(store) >= 0, "Loja não autorizada.");
}

function decodeClosingFile_(dataUrl, informedMimeType) {
  const match = String(dataUrl || "").match(
    /^data:([^;]+);base64,([A-Za-z0-9+/=\s]+)$/,
  );
  assert_(match, "Comprovante inválido.");
  const mimeType = String(informedMimeType || match[1] || "").toLowerCase();
  const allowed = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
    "application/pdf",
  ];
  assert_(
    allowed.indexOf(mimeType) >= 0 && match[1].toLowerCase() === mimeType,
    "Formato não permitido.",
  );
  const bytes = Utilities.base64Decode(match[2].replace(/\s/g, ""));
  assert_(bytes.length > 0, "O comprovante está vazio.");
  assert_(
    bytes.length <= CLOSING_SERVICE_CONFIG_.maxFileBytes,
    "O comprovante ultrapassa 2 MB.",
  );
  return {bytes: bytes, mimeType: mimeType};
}

function extensionForMimeType_(mimeType) {
  return {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
    "application/pdf": "pdf",
  }[mimeType] || "bin";
}

function closingDestinationFolder_(store, day) {
  const storeName = safeName_(store);
  const cache = CacheService.getScriptCache();
  const cacheKey = ["closing-folder", day.slice(0, 7), storeName].join(":");
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
    const root = DriveApp.getFolderById(CLOSING_SERVICE_CONFIG_.folderId);
    const service = childFolder_(root, CLOSING_SERVICE_CONFIG_.folderName);
    const year = childFolder_(service, day.slice(0, 4));
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

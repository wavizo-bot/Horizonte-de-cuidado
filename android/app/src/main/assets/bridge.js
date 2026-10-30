/* ==========================================================================
   Horizonte de Cuidado — ponte Android (WebView nativo).

   O app web fala com um host de sincronização em window.chrome.webview.
   hostObjects.horizonteHost (contrato do MSIX/WebView2). Este script, injetado
   no início do documento, expõe o MESMO contrato sobre a interface Java
   window.HorizonteAndroid (addJavascriptInterface), sem alterar uma linha da
   lógica React/TypeScript:

     GetAppVersion / SaveTextFile / OpenTextFile / Quit
     DriveGetState / DriveLogin / DriveLogout / DriveCheckRemote
     DriveRestoreFile / DriveBackup / DriveResetCloud

   Cada chamada Java devolve a resposta de forma assíncrona em
   window.__horizonteResolve(id, resultado), então os métodos aqui retornam
   Promise exatamente como o WebView2 fazia.

   Também cobre o que o WebView não implementa sozinho:
     - window.print()  -> PrintManager do Android
     - window.open()   -> Intent do sistema (WhatsApp, SMS, e-mail, sites)
     - service worker  -> removido (o APK já entrega o bundle local)
   ========================================================================== */
(function () {
  "use strict";

  var Native = window.HorizonteAndroid;
  var nextId = 1;
  var pending = Object.create(null);

  /* --------------------------------------------------------------- bridge -- */

  window.__horizonteResolve = function (id, result) {
    var entry = pending[id];
    if (!entry) return;
    delete pending[id];
    if (entry.timer) clearTimeout(entry.timer);
    if (result === null || result === undefined) {
      entry.resolve(null);
    } else {
      entry.resolve(String(result));
    }
  };

  function invoke(method, args, timeoutMs) {
    if (!Native || typeof Native.call !== "function") {
      return Promise.resolve(null);
    }
    return new Promise(function (resolve) {
      var id = nextId++;
      var timer = setTimeout(function () {
        if (pending[id]) {
          delete pending[id];
          resolve(null);
        }
      }, timeoutMs || 90000);
      pending[id] = { resolve: resolve, timer: timer };
      try {
        Native.call(JSON.stringify({ id: id, method: method, args: args || [] }));
      } catch (e) {
        delete pending[id];
        clearTimeout(timer);
        resolve(null);
      }
    });
  }

  var hostObject = {
    GetAppVersion: function () {
      return invoke("GetAppVersion", [], 20000);
    },
    SaveTextFile: function (defaultName, content) {
      return invoke("SaveTextFile", [String(defaultName == null ? "" : defaultName),
        String(content == null ? "" : content)], 120000);
    },
    OpenTextFile: function () {
      /* O usuário pode demorar no seletor de arquivos. */
      return invoke("OpenTextFile", [], 600000);
    },
    Quit: function () {
      return invoke("Quit", [], 10000).then(function () { return "closing"; });
    },
    DriveGetState: function () {
      return invoke("DriveGetState", [], 30000);
    },
    DriveLogin: function () {
      /* O seletor de contas do Google é nativo; o host expira em 120 s. */
      return invoke("DriveLogin", [], 180000);
    },
    DriveLogout: function () {
      return invoke("DriveLogout", [], 20000);
    },
    DriveCheckRemote: function () {
      return invoke("DriveCheckRemote", [], 90000);
    },
    DriveRestoreFile: function (fileId) {
      return invoke("DriveRestoreFile", [String(fileId == null ? "" : fileId)], 120000);
    },
    DriveBackup: function (payload) {
      return invoke("DriveBackup", [String(payload == null ? "" : payload)], 120000);
    },
    DriveResetCloud: function (payload) {
      return invoke("DriveResetCloud", [String(payload == null ? "" : payload)], 120000);
    }
  };

  try {
    window.chrome = window.chrome || {};
    window.chrome.webview = window.chrome.webview || {};
    window.chrome.webview.hostObjects = window.chrome.webview.hostObjects || {};
    window.chrome.webview.hostObjects.horizonteHost = hostObject;
  } catch (e) {
    /* Objeto congelado: o app continua em modo local, sem quebrar. */
  }

  /* -------------------------------------------------------------- sistema -- */

  var nativePrint = window.print;
  window.print = function () {
    if (Native) {
      invoke("Print", [], 20000);
      return;
    }
    if (typeof nativePrint === "function") nativePrint.call(window);
  };

  var nativeOpen = window.open;
  window.open = function (url) {
    var target = url == null ? "" : String(url);
    if (Native && /^(https?:|mailto:|tel:|sms:|whatsapp:)/i.test(target)) {
      invoke("OpenExternal", [target], 20000);
      return null;
    }
    return nativeOpen ? nativeOpen.apply(window, arguments) : null;
  };

  /* Links com target="_blank" (termos, privacidade) e wa.me: o WebView
     mantém os internos (mesma origem) e o MainActivity manda os externos
     para o app/navegador do sistema. Nada a interceptar aqui. */

  /* Botão Voltar do Android: fecha o painel de navegação ou o modal do topo
     antes de navegar no histórico. O MainActivity só sai se retornar false. */
  window.__horizonteHandleBack = function () {
    var drawerClose = document.querySelector(".drawer__close");
    if (drawerClose) {
      drawerClose.click();
      return true;
    }
    var backdrops = document.querySelectorAll(".modal-backdrop");
    if (backdrops.length > 0) {
      var top = backdrops[backdrops.length - 1];
      top.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      return true;
    }
    return false;
  };

  try {
    document.documentElement.classList.add("horizonte-android");
  } catch (e) {}

  /* O APK já entrega o bundle local; um service worker só arriscaria servir
     uma versão antiga depois de atualizar o aplicativo. */
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      navigator.serviceWorker.getRegistrations().then(function (list) {
        for (var i = 0; i < list.length; i++) {
          try { list[i].unregister(); } catch (e) {}
        }
      }).catch(function () {});
    }
  } catch (e) {}
})();

const fs = require('fs');
const path = require('path');

function patchUtils() {
  const possiblePaths = [
    path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js', 'src', 'util', 'Injected', 'Utils.js'),
    path.join(__dirname, '..', '..', 'node_modules', 'whatsapp-web.js', 'src', 'util', 'Injected', 'Utils.js'),
  ];

  try {
    const mainPkg = require.resolve('whatsapp-web.js');
    const resolvedPath = path.join(path.dirname(mainPkg), 'src', 'util', 'Injected', 'Utils.js');
    if (!possiblePaths.includes(resolvedPath)) {
      possiblePaths.unshift(resolvedPath);
    }
  } catch (_) {}

  let targetPath = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      targetPath = p;
      break;
    }
  }

  if (!targetPath) {
    console.log('⚠️ [PATCH-WWEBJS] No se encontró Utils.js de whatsapp-web.js (posiblemente aún no instalado).');
    return;
  }

  try {
    let content = fs.readFileSync(targetPath, 'utf8');

    if (content.includes('// [FANTASIAS-PATCH-MEMOIZE]')) {
      console.log('✅ [PATCH-WWEBJS] Utils.js ya tiene aplicado el parche de memoize/media.');
      return;
    }

    const targetPattern = 'const [msgPromise, sendMsgResultPromise] = window.Store.SendMessage.addAndSendMsgToChat(chat, message);';
    if (!content.includes(targetPattern)) {
      console.warn('⚠️ [PATCH-WWEBJS] No se encontró el punto de inserción en Utils.js');
      return;
    }

    const patchCode = `
        // [FANTASIAS-PATCH-MEMOIZE] Garantizar que 'id' y 'contact' estén presentes para evitar:
        // "Data passed to getter must include an id property (it's how we memoize) but got undefined"
        if (message) {
            message.id = newMsgKey;
        }
        if (chat) {
            if (!chat.contact && chat.id) {
                const existing = window.Store?.Contact?.get(chat.id);
                chat.contact = existing || { id: chat.id };
            }
            if (chat.contact && !chat.contact.id && chat.id) {
                chat.contact.id = chat.id;
            }
        }
        const [msgPromise, sendMsgResultPromise] = window.Store.SendMessage.addAndSendMsgToChat(chat, message);`;

    content = content.replace(targetPattern, patchCode);
    fs.writeFileSync(targetPath, content, 'utf8');
    console.log(`✅ [PATCH-WWEBJS] Parche aplicado exitosamente en ${targetPath}`);
  } catch (err) {
    console.error(`❌ [PATCH-WWEBJS] Error aplicando parche en Utils.js: ${err.message}`);
  }
}

patchUtils();

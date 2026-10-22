// Baixa um backup guardado no banco de backups (BACKUP_STORAGE_URL) para o
// disco local, para restaurar quando for preciso. Só pela linha de comando,
// por quem tem a credencial do banco de backups — a API nunca serve o
// conteúdo de um backup.
//
//   npm run backup:baixar                      -> lista os backups do ambiente
//   npm run backup:baixar -- ultimo            -> baixa o mais recente
//   npm run backup:baixar -- <arquivo.sql.gz>  -> baixa um específico
//
// O ambiente é o de BACKUP_ENVIRONMENT; para outro, use BACKUP_ENVIRONMENT=qa
// (ou dev, producao) antes do comando. Para restaurar o arquivo baixado num
// banco vazio:  gunzip -c arquivo.sql.gz | psql "URL_DO_BANCO_DE_DESTINO"
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const storage = require('./backupStorage');

function formatSize(bytes) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main() {
  if (!storage.isEnabled()) {
    throw new Error('BACKUP_STORAGE_URL não configurada — não há banco de backups para consultar.');
  }
  const wanted = process.argv[2];

  if (!wanted) {
    const items = await storage.listBackups();
    console.log(`Backups do ambiente "${storage.ENVIRONMENT}" (${items.length}):`);
    for (const b of items) {
      console.log(`  ${b.fileName}  ${formatSize(b.sizeBytes).padStart(9)}  ${new Date(b.createdAt).toLocaleString('pt-BR')}`);
    }
    if (items.length) console.log('\nPara baixar: npm run backup:baixar -- ultimo   (ou o nome do arquivo)');
    return;
  }

  const backup = await storage.readBackup({ fileName: wanted === 'ultimo' ? undefined : wanted });
  if (!backup) throw new Error(`Backup "${wanted}" não encontrado no ambiente "${storage.ENVIRONMENT}".`);
  const target = path.resolve(backup.fileName);
  await fs.promises.writeFile(target, backup.data);
  console.log(`Backup salvo em ${target} (${formatSize(backup.data.length)}).`);
  console.log('Ele contém dados reais: apague o arquivo depois de usar.');
}

main()
  .catch((err) => {
    console.error('[backup:baixar]', err.message);
    process.exitCode = 1;
  })
  .finally(() => storage.close());

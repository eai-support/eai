import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const relativePath = 'lib/generated/application-package.schema.json';
const destination = path.join(root, 'dist', relativePath);

await mkdir(path.dirname(destination), { recursive: true });
await copyFile(path.join(root, 'src', relativePath), destination);

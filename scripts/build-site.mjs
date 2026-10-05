import { webcrypto } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const { subtle } = webcrypto;
const encoder = new TextEncoder();
const GIFT_CODE = "7CDEEBED04964081";
const ITERATIONS = 600_000;
export const PUBLIC_FILES = ["index.html", "styles.css", "script.js", "assets/download.svg", "puzzle.json", "reward.bin"];

export function normalizeAnswer(value) {
  return value.normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/[\s«»"'.,!?…]+/g, "");
}

export function parseQuestions(markdown) {
  const questions = markdown.split("\n").filter(line => /^\| \d/.test(line)).map(line => {
    const cells = line.split("|").map(cell => cell.trim());
    if (cells.length !== 6) throw new Error("Некорректная строка таблицы вопросов");
    const [, , number, text, answer] = cells;
    const answers = answer.split("/").map(value => value.trim());
    if (!text || answers.some(value => !normalizeAnswer(value))) throw new Error("Пустой вопрос или ответ");
    return { number: Number(number), text, answers };
  }).sort((left, right) => left.number - right.number);
  if (questions.length !== 16 || questions.some((question, index) => question.number !== index + 1)) {
    throw new Error("В таблице должны быть вопросы с уникальными номерами от 1 до 16");
  }
  return questions;
}

function randomBytes(length) {
  return webcrypto.getRandomValues(new Uint8Array(length));
}

function base64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

export async function createPuzzle(questions, photo) {
  const id = base64(randomBytes(16));
  const parts = [];
  const publicQuestions = [];
  for (const question of questions) {
    const part = randomBytes(32);
    parts.push(part);
    const variants = [];
    for (const answer of question.answers) {
      const salt = randomBytes(16);
      const iv = randomBytes(12);
      const material = await subtle.importKey("raw", encoder.encode(normalizeAnswer(answer)), "PBKDF2", false, ["deriveKey"]);
      const key = await subtle.deriveKey({
        name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt
      }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
      const ciphertext = await subtle.encrypt({
        name: "AES-GCM", iv, additionalData: encoder.encode(`${id}:question:${question.number}`)
      }, key, part);
      variants.push({ salt: base64(salt), iv: base64(iv), ciphertext: base64(ciphertext) });
    }
    publicQuestions.push({ number: question.number, text: question.text, variants });
  }
  const combined = new Uint8Array(parts.length * 32);
  parts.forEach((part, index) => combined.set(part, index * 32));
  const digest = await subtle.digest("SHA-256", combined);
  const key = await subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt"]);
  const iv = randomBytes(12);
  const plaintext = encoder.encode(JSON.stringify({ code: GIFT_CODE, photo: base64(photo) }));
  const reward = new Uint8Array(await subtle.encrypt({
    name: "AES-GCM", iv, additionalData: encoder.encode(`${id}:reward`)
  }, key, plaintext));
  return {
    puzzle: { version: 1, id, iterations: ITERATIONS, questions: publicQuestions, reward: { iv: base64(iv) } },
    reward
  };
}

async function listFiles(directory, prefix = "") {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(join(directory, entry.name), relative + "/"));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`В сборке недопустима ссылка или специальный файл: ${relative}`);
  }
  return files;
}

export async function buildSite() {
  const destination = join(root, "dist");
  const existing = await listFiles(destination);
  const unexpected = existing.filter(path => !PUBLIC_FILES.includes(path));
  if (unexpected.length) throw new Error(`В dist найдены непубликуемые файлы: ${unexpected.join(", ")}`);
  const questions = parseQuestions(await readFile(join(root, "questions.md"), "utf8"));
  const photo = await readFile(join(root, "assets/final-photo.jpg"));
  const { puzzle, reward } = await createPuzzle(questions, photo);
  for (const path of PUBLIC_FILES.filter(path => path !== "puzzle.json" && path !== "reward.bin")) {
    await mkdir(dirname(join(destination, path)), { recursive: true });
    await copyFile(join(root, path), join(destination, path));
  }
  await writeFile(join(destination, "puzzle.json"), JSON.stringify(puzzle) + "\n");
  await writeFile(join(destination, "reward.bin"), reward);
  console.log("Сайт собран в dist: только интерфейс и зашифрованные данные.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  buildSite().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

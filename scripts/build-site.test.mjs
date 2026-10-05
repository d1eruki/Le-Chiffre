import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { before, test } from "node:test";
import { createPuzzle, parseQuestions, PUBLIC_FILES } from "./build-site.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
let source;
let table;
let questions;
let puzzle;
let reward;
let photo;
let expectedCode;

before(async () => {
  source = await readFile(join(root, "dist/script.js"), "utf8");
  table = await readFile(join(root, "questions.md"), "utf8");
  questions = parseQuestions(table);
  puzzle = JSON.parse(await readFile(join(root, "dist/puzzle.json"), "utf8"));
  reward = await readFile(join(root, "dist/reward.bin"));
  photo = await readFile(join(root, "assets/final-photo.jpg"));
  const builder = await readFile(join(root, "scripts/build-site.mjs"), "utf8");
  expectedCode = builder.match(/const GIFT_CODE = "([^"]+)";/)[1];
});

function element() {
  return {
    value: "", disabled: false, textContent: "", children: [], handlers: {}, attributes: {},
    scrollTop: 0, scrollHeight: 0, clientHeight: 0,
    classList: { add() {}, remove() {} },
    append(...children) { this.children.push(...children); },
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
    addEventListener(event, handler) { this.handlers[event] = handler; },
    focus() {}
  };
}

async function client(options = {}) {
  const elements = new Map();
  const blobs = [];
  const fetched = [];
  const errors = [];
  const events = new Map();
  const revoked = [];
  const get = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const context = vm.createContext({
    console: { error: error => errors.push(error) },
    crypto: options.noCrypto ? {} : webcrypto,
    TextEncoder, TextDecoder, Uint8Array, Blob, atob,
    URL: {
      createObjectURL(blob) { blobs.push(blob); return "blob:le-chiffre-test"; },
      revokeObjectURL(url) { revoked.push(url); }
    },
    document: { getElementById: get, querySelector: () => get("terminal"), createElement: element },
    window: {
      matchMedia: () => ({ matches: true }),
      addEventListener(event, handler) { events.set(event, handler); }
    },
    setTimeout: callback => { callback(); return 0; },
    fetch: async path => {
      fetched.push(path);
      if (path === "./puzzle.json") {
        return { ok: !options.manifestUnavailable, json: async () => options.puzzle || puzzle };
      }
      assert.equal(path, "./reward.bin");
      return {
        ok: !options.rewardUnavailable,
        arrayBuffer: async () => Uint8Array.from(options.reward || reward).buffer
      };
    }
  });
  vm.runInContext(source, context);
  // Загрузчик квеста асинхронный; ждём его, не запускаем браузер.
  await new Promise(resolve => setImmediate(resolve));
  return {
    context, get, blobs, fetched, errors, events, revoked,
    value: expression => vm.runInContext(expression, context),
    submit: async answer => {
      get("message").value = answer;
      await get("message-form").handlers.submit({ preventDefault() {} });
    },
    messages: () => get("messages").children.flatMap(item => item.children.map(child => child.textContent))
  };
}

async function complete(game, alternative = false) {
  for (let index = 0; index < questions.length; index++) {
    const question = questions[index];
    const answer = alternative && question.number === 13 ? question.answers[1] : question.answers[0];
    const decorated = ` «${answer.toUpperCase().replaceAll(" ", "  ")}!» `;
    await game.submit(decorated);
    assert.equal(game.value("questionIndex"), index + 1);
  }
}

async function publishedFiles(directory, prefix = "") {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) paths.push(...await publishedFiles(join(directory, entry.name), path + "/"));
    else {
      assert(entry.isFile(), "В публикации не должно быть ссылок");
      paths.push(path);
    }
  }
  return paths;
}

test("Публикация содержит только разрешённые файлы без открытых ответов и подарка", async () => {
  const files = await publishedFiles(join(root, "dist"));
  assert.deepEqual(files.sort(), [...PUBLIC_FILES].sort());
  const secrets = [...questions.flatMap(question => question.answers), expectedCode];
  for (const path of files) {
    const bytes = await readFile(join(root, "dist", path));
    for (const secret of secrets) {
      assert(!bytes.includes(Buffer.from(secret)), `В ${path} найдено открытое значение из закрытых данных`);
    }
    assert(!bytes.includes(photo), "Исходная фотография не должна входить в публикацию");
    assert(!bytes.includes(Buffer.from(photo.toString("base64"))), "Фотография не должна публиковаться в Base64");
  }
  assert.equal(puzzle.iterations, 600_000);
  assert.equal(puzzle.questions.length, questions.length);
  for (let index = 0; index < questions.length; index++) {
    assert.equal(puzzle.questions[index].text, questions[index].text);
    assert.equal(puzzle.questions[index].number, questions[index].number);
    assert.equal(puzzle.questions[index].variants.length, questions[index].answers.length);
    assert(!("answers" in puzzle.questions[index]) && !("answer" in puzzle.questions[index]));
  }
});

test("Ошибки нумерации и пустые ответы в таблице останавливают сборку", () => {
  assert.throws(() => parseQuestions(table.replace("| 8 | 15 |", "| 8 | 14 |")));
  assert.throws(() => parseQuestions(table.replace("| сожалений |", "|  |")));
});

for (const alternative of [false, true]) {
  test(`Полное прохождение с ${alternative ? "альтернативным" : "основным"} ответом №13 открывает исходный подарок`, async () => {
    const game = await client();
    assert.equal(game.value("stage"), "riddle");
    assert(game.messages().includes(questions[0].text));
    await game.submit("это неверный ответ");
    assert.equal(game.value("questionIndex"), 0);
    assert.equal(game.value("keyParts.length"), 0);
    assert.equal(game.get("message").attributes["aria-invalid"], "true");
    await complete(game, alternative);
    assert.equal(game.value("stage"), "success");
    assert.equal(game.get("message").disabled, true);
    assert.equal(game.get("send").disabled, true);
    assert(game.messages().includes(expectedCode), "Расшифрованный код должен совпадать с исходным");
    assert.equal(game.blobs.length, 1);
    const bytes = Buffer.from(await game.blobs[0].arrayBuffer());
    assert(bytes.equals(photo), "Расшифрованная фотография должна совпадать с исходной");
    assert.equal(game.errors.length, 0);
    assert.deepEqual(game.fetched, ["./puzzle.json", "./reward.bin"]);
    game.events.get("pagehide")();
    assert.deepEqual(game.revoked, ["blob:le-chiffre-test"]);
  });
}

test("Перенос счётчика на последний вопрос не открывает подарок", async () => {
  const game = await client();
  vm.runInContext("questionIndex = 15", game.context);
  await game.submit(questions[15].answers[0]);
  assert.equal(game.value("stage"), "riddle");
  assert.equal(game.value("questionIndex"), 15);
  assert.equal(game.blobs.length, 0);
  assert(!game.messages().includes(expectedCode));
  assert.equal(game.errors.length, 1);
});

test("Объединение двух вариантов №13 и изменение шифротекста не принимаются", async () => {
  const game = await client();
  vm.runInContext("questionIndex = 12", game.context);
  await game.submit(questions[12].answers.join(" / "));
  assert.equal(game.value("questionIndex"), 12);
  assert.equal(game.value("keyParts.length"), 0);
  const changed = structuredClone(puzzle);
  const bytes = Buffer.from(changed.questions[0].variants[0].ciphertext, "base64");
  bytes[0] ^= 1;
  changed.questions[0].variants[0].ciphertext = bytes.toString("base64");
  const corrupted = await client({ puzzle: changed });
  await corrupted.submit(questions[0].answers[0]);
  assert.equal(corrupted.value("questionIndex"), 0);
  assert.equal(corrupted.blobs.length, 0);
  assert(!corrupted.fetched.includes("./reward.bin"));
});

test("Сбой загрузки подарка позволяет повторить последний ответ без потери прогресса", async () => {
  const options = { rewardUnavailable: true };
  const game = await client(options);
  for (const question of questions.slice(0, -1)) await game.submit(question.answers[0]);
  await game.submit(questions[15].answers[0]);
  assert.equal(game.value("questionIndex"), 15);
  assert.equal(game.value("keyParts.length"), 15);
  assert.equal(game.get("message").value, questions[15].answers[0]);
  assert.equal(game.get("send").disabled, false);
  assert.equal(game.blobs.length, 0);
  options.rewardUnavailable = false;
  await game.submit(questions[15].answers[0]);
  assert.equal(game.value("stage"), "success");
});

test("Подмена подарка и смешивание частей разных сборок не раскрывают данные", async () => {
  const corruptedReward = Buffer.from(reward);
  corruptedReward[0] ^= 1;
  const damaged = await client({ reward: corruptedReward });
  for (const question of questions) await damaged.submit(question.answers[0]);
  assert.equal(damaged.value("stage"), "riddle");
  assert.equal(damaged.blobs.length, 0);
  assert(!damaged.messages().includes(expectedCode));
  const nextBuild = await createPuzzle(questions, photo);
  assert.notEqual(nextBuild.puzzle.id, puzzle.id);
  const first = await client();
  const second = await client({ puzzle: nextBuild.puzzle, reward: nextBuild.reward });
  const part = await vm.runInContext(`unlockAnswer(${JSON.stringify(questions[0].answers[0])}, puzzle.questions[0])`, first.context);
  const parts = await Promise.all(questions.map((question, index) => vm.runInContext(
    `unlockAnswer(${JSON.stringify(question.answers[0])}, puzzle.questions[${index}])`, second.context)));
  parts[0] = part;
  second.context.mixedParts = parts;
  await assert.rejects(vm.runInContext("unlockReward(mixedParts)", second.context), { name: "OperationError" });
});

test("Сбой загрузки вопросов и отсутствие Web Crypto блокируют ввод", async () => {
  for (const options of [{ manifestUnavailable: true }, { noCrypto: true }]) {
    const game = await client(options);
    assert.equal(game.value("stage"), "error");
    assert.equal(game.get("message").disabled, true);
    assert.equal(game.get("send").disabled, true);
    assert.equal(game.blobs.length, 0);
  }
});

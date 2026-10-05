"use strict";
const $ = id => document.getElementById(id);
const messages = $("messages");
const input = $("message");
const send = $("send");
const terminal = document.querySelector(".terminal");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const keyParts = [];
let puzzle;
let photoUrl;
let stage = "loading";
let questionIndex = 0;
let busy = false;

function normalizeAnswer(value) {
  return value.normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/[\s«»"'.,!?…]+/g, "");
}

function decodeBase64(value) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

async function unlockAnswer(answer, question) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(normalizeAnswer(answer)), "PBKDF2", false, ["deriveKey"]);
  for (const variant of question.variants) {
    const key = await crypto.subtle.deriveKey({
      name: "PBKDF2", hash: "SHA-256", iterations: puzzle.iterations, salt: decodeBase64(variant.salt)
    }, material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    try {
      const part = await crypto.subtle.decrypt({
        name: "AES-GCM", iv: decodeBase64(variant.iv),
        additionalData: encoder.encode(`${puzzle.id}:question:${question.number}`)
      }, key, decodeBase64(variant.ciphertext));
      if (part.byteLength !== 32) throw new Error("Некорректный фрагмент ключа");
      return new Uint8Array(part);
    } catch (error) {
      if (error.name !== "OperationError") throw error;
    }
  }
  return null;
}

async function unlockReward(parts) {
  const combined = new Uint8Array(parts.length * 32);
  parts.forEach((part, index) => combined.set(part, index * 32));
  const digest = await crypto.subtle.digest("SHA-256", combined);
  const key = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["decrypt"]);
  const response = await fetch("./reward.bin", { cache: "no-store" });
  if (!response.ok) throw new Error("Не удалось загрузить подарок");
  const plaintext = await crypto.subtle.decrypt({
    name: "AES-GCM", iv: decodeBase64(puzzle.reward.iv),
    additionalData: encoder.encode(`${puzzle.id}:reward`)
  }, key, await response.arrayBuffer());
  return JSON.parse(decoder.decode(plaintext));
}

async function addMessage(text, author = "project", success = false) {
  const message = document.createElement("p");
  message.className = "message message--" + author + (success ? " message--success" : "");
  const accessible = document.createElement("span");
  accessible.className = "sr-only";
  accessible.textContent = (author === "user" ? "Ты: " : "Le Chiffre: ") + text;
  const visual = document.createElement("span");
  visual.setAttribute("aria-hidden", "true");
  message.append(accessible, visual);
  messages.append(message);
  if (author === "user" || reducedMotion.matches) {
    visual.textContent = text;
    messages.scrollTop = messages.scrollHeight;
    return;
  }
  visual.className = "typing";
  messages.scrollTop = messages.scrollHeight;
  const characters = Array.from(text);
  const interval = Math.min(38, 1000 / characters.length);
  for (let index = 0; index < characters.length; index++) {
    const follow = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 36;
    if (reducedMotion.matches) {
      visual.textContent = text;
      if (follow) messages.scrollTop = messages.scrollHeight;
      break;
    }
    visual.textContent += characters[index];
    if (follow) messages.scrollTop = messages.scrollHeight;
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  visual.className = "";
}

function updateSendState() {
  send.disabled = busy || stage !== "riddle" || !input.value.trim();
}

function addPhotoMessage(photoData) {
  const message = document.createElement("figure");
  message.className = "message message--project message--photo";
  message.setAttribute("aria-label", "Le Chiffre: фотография");
  const photo = document.createElement("img");
  photo.className = "message-photo";
  photoUrl = URL.createObjectURL(new Blob([decodeBase64(photoData)], { type: "image/jpeg" }));
  photo.src = photoUrl;
  photo.alt = "Человек в очках на фоне бетонной площадки и деревьев";
  photo.width = 768;
  photo.height = 1024;
  const download = document.createElement("a");
  download.className = "photo-download";
  download.href = photo.src;
  download.download = "le-chiffre.jpg";
  download.setAttribute("aria-label", "Скачать фотографию");
  download.title = "Скачать фотографию";
  const icon = document.createElement("span");
  icon.className = "download-icon";
  icon.setAttribute("aria-hidden", "true");
  download.append(icon);
  message.append(photo, download);
  messages.append(message);
  messages.scrollTop = messages.scrollHeight;
}

function setBusy(value) {
  busy = value;
  input.disabled = value || stage !== "riddle";
  updateSendState();
  $("composer-status").textContent = value ? "Le Chiffre отвечает…" : "";
}

async function showIncorrectAnswer() {
  input.setAttribute("aria-invalid", "true");
  terminal.classList.add("terminal--incorrect");
  try {
    await new Promise(resolve => setTimeout(resolve, 350));
  } finally {
    terminal.classList.remove("terminal--incorrect");
  }
}

input.addEventListener("input", () => {
  input.removeAttribute("aria-invalid");
  $("composer-status").textContent = "";
  updateSendState();
});

$("message-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || stage !== "riddle") return;
  const answer = input.value.trim();
  if (!answer) return;
  input.removeAttribute("aria-invalid");
  setBusy(true);
  try {
    await addMessage(answer, "user");
    const question = puzzle.questions[questionIndex];
    const part = await unlockAnswer(answer, question);
    if (!part) {
      input.value = "";
      await showIncorrectAnswer();
      await addMessage(question.text);
      return;
    }
    if (questionIndex === puzzle.questions.length - 1) {
      const reward = await unlockReward([...keyParts, part]);
      input.value = "";
      questionIndex++;
      stage = "success";
      keyParts.length = 0;
      for (let index = 0; index < 13; index++) {
        await addMessage("я тебя могну");
      }
      addPhotoMessage(reward.photo);
      await addMessage("…");
      await addMessage(reward.code, "project", true);
    } else {
      keyParts.push(part);
      input.value = "";
      questionIndex++;
      await addMessage(puzzle.questions[questionIndex].text);
    }
  } catch (error) {
    console.error(error);
    await addMessage("Не удалось обработать ответ. Попробуй отправить его ещё раз.");
  } finally {
    setBusy(false);
    if (stage === "riddle") input.focus();
  }
});

async function startConversation() {
  setBusy(true);
  try {
    if (!globalThis.crypto?.subtle) throw new Error("Web Crypto недоступен");
    const response = await fetch("./puzzle.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Не удалось загрузить вопросы");
    puzzle = await response.json();
    if (puzzle.version !== 1 || puzzle.questions.length !== 16) throw new Error("Некорректный формат квеста");
    stage = "riddle";
    await addMessage(puzzle.questions[0].text);
  } catch (error) {
    stage = "error";
    console.error(error);
    await addMessage("Не удалось загрузить квест. Обнови страницу или попробуй позже.");
  } finally {
    setBusy(false);
  }
}
window.addEventListener("pagehide", () => {
  if (photoUrl) URL.revokeObjectURL(photoUrl);
});
startConversation();

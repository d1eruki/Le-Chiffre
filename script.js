"use strict";
const GIFT_CODE = "7CDEEBED04964081";
const QUESTIONS = [
  { text: "Мир полон…", answer: "банальности" },
  { text: "Жить словами тех, кто ушёл, …", answer: "отвратительно" },
  { text: "Иметь предубеждение — не…", answer: "комильфо" },
  { text: "В этом мире вообще лучше поменьше…", answer: "знать" },
  { text: "Что расположено у тебя в груди?", answer: "пустота" },
  { text: "Жизнь…", answer: "прекрасна" },
  { text: "Она близка к…", answer: "истине" },
  { text: "Улыбаясь даже в…", answer: "невзгоды" },
  { text: "Когда относишься к подаркам людей как к…", answer: "мусору" },
  { text: "Кто-то вторгся в твою…", answer: "душу" },
  { text: "Почему так много жизней пожертвовано ради…", answer: "одной" },
  { text: "Улыбаться — это очень…", answer: "важно" },
  { text: "Жить, чтобы убивать? Или жить, чтобы…", answer: "умереть" },
  { text: "От тебя веет…", answer: "опасностью" },
  { text: "В этот момент слова вылетают…", answer: "бездумно" },
  { text: "Нет смысла терять тут…", answer: "время" }
];
const $ = id => document.getElementById(id);
const messages = $("messages");
const input = $("message");
const send = $("send");
const terminal = document.querySelector(".terminal");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let stage = "riddle";
let questionIndex = 0;
let busy = false;

function normalizeAnswer(value) {
  return value.normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/[\s«»"'.,!?…]+/g, "");
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
  send.disabled = busy || stage === "success" || !input.value.trim();
}

function addPhotoMessage() {
  const message = document.createElement("figure");
  message.className = "message message--project message--photo";
  message.setAttribute("aria-label", "Le Chiffre: фотография");
  const photo = document.createElement("img");
  photo.className = "message-photo";
  photo.src = "./assets/final-photo.jpg";
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
  input.disabled = value || stage === "success";
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
  if (busy || stage === "success") return;
  const answer = input.value.trim();
  if (!answer) return;
  input.removeAttribute("aria-invalid");
  setBusy(true);
  try {
    await addMessage(answer, "user");
    input.value = "";
    if (stage === "riddle") {
      if (normalizeAnswer(answer) === QUESTIONS[questionIndex].answer) {
        questionIndex++;
        if (questionIndex < QUESTIONS.length) {
          await addMessage(QUESTIONS[questionIndex].text);
        } else {
          stage = "success";
          for (let index = 0; index < 13; index++) {
            await addMessage("я тебя могну");
          }
          addPhotoMessage();
          await addMessage("…");
          await addMessage(GIFT_CODE, "project", true);
        }
      } else {
        await showIncorrectAnswer();
        await addMessage(QUESTIONS[questionIndex].text);
      }
      return;
    }
  } catch (error) {
    console.error(error);
  } finally {
    setBusy(false);
    if (stage !== "success") input.focus();
  }
});

async function startConversation() {
  setBusy(true);
  await addMessage(QUESTIONS[0].text);
  setBusy(false);
}
startConversation();

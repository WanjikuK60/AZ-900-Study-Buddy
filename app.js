// App logic. Study content lives in data.js, which loads first.

const storageKey = "studybuddy-az900-v1";
const apiBaseUrl = typeof window.STUDY_BUDDY_API_URL === "string"
  ? window.STUDY_BUDDY_API_URL.trim().replace(/\/+$/, "")
  : "";
const dom = {
  languageSelect: document.querySelector("#language-select"),
  levelSelect: document.querySelector("#learner-level"),
  chatLanguage: document.querySelector("#chat-language"),
  capability: document.querySelector("#buddy-capability"),
  privacyNote: document.querySelector("#privacy-note"),
  askForm: document.querySelector("#ask-form"),
  questionInput: document.querySelector("#question-input"),
  chatLog: document.querySelector("#chat-log"),
  topicGrid: document.querySelector("#topic-grid"),
  topicSearch: document.querySelector("#topic-search"),
  filterButtons: [...document.querySelectorAll(".filter-button")],
  emptyState: document.querySelector("#empty-state"),
  quizContent: document.querySelector("#quiz-content"),
  toast: document.querySelector("#toast"),
  weakTopics: document.querySelector("#weak-topics")
};

function loadProgress() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
    const validLevels = ["beginner", "intermediate", "exam"];
    const validLanguages = ["en", "sw", "sheng"];
    const savedWeaknesses = stored.weaknesses && typeof stored.weaknesses === "object" ? stored.weaknesses : {};
    return {
      viewed: Array.isArray(stored.viewed) ? stored.viewed.filter(id => topics.some(topic => topic.id === id)) : [],
      correct: Number.isInteger(stored.correct) && stored.correct >= 0 ? stored.correct : 0,
      answered: Number.isInteger(stored.answered) && stored.answered >= 0 ? stored.answered : 0,
      language: validLanguages.includes(stored.language) ? stored.language : "en",
      level: validLevels.includes(stored.level) ? stored.level : "beginner",
      weaknesses: Object.fromEntries(quizDetails.map(({ conceptId }) => {
        const record = savedWeaknesses[conceptId];
        return [conceptId, {
          attempts: Number.isInteger(record?.attempts) && record.attempts > 0 ? record.attempts : 0,
          missed: Number.isInteger(record?.missed) && record.missed > 0 ? record.missed : 0
        }];
      }))
    };
  } catch (error) {
    window.setTimeout(() => showToast(copy.en.storageWarning), 0);
    return { viewed: [], correct: 0, answered: 0, language: "en", level: "beginner", weaknesses: {} };
  }
}

const saved = loadProgress();
const state = {
  language: saved.language,
  level: saved.level,
  viewed: new Set(saved.viewed),
  correct: saved.correct,
  answered: saved.answered,
  weaknesses: saved.weaknesses,
  filter: "all",
  search: "",
  lastQuestion: "",
  lastAnswer: null,
  answerRequestId: 0,
  quizIndex: 0,
  quizSelection: null,
  quizComplete: false,
  simpleMode: false,
  simpleModeTopic: null
};

function currentCopy() {
  return copy[state.language];
}

function currentUiCopy() {
  return state.language === "sw" ? copy.sw.ui : copy.en.ui;
}

function topicTitle(topic) {
  return state.language === "sw" ? copy.sw.topicTitles[topic.id] : topic.title;
}

function translateStaticUi() {
  const text = currentUiCopy();
  for (const element of document.querySelectorAll("[data-i18n]")) {
    const translated = text[element.dataset.i18n];
    if (translated === undefined) continue;
    const textNode = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.nodeValue = ` ${translated} `;
    else element.textContent = translated;
  }
  for (const element of document.querySelectorAll("[data-i18n-aria]")) {
    const translated = text[element.dataset.i18nAria];
    if (translated !== undefined) element.setAttribute("aria-label", translated);
  }
  for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
    const translated = text[element.dataset.i18nPlaceholder];
    if (translated !== undefined) element.setAttribute("placeholder", translated);
  }
  document.title = text.pageTitle;
  document.querySelector('meta[name="description"]').content = text.description;
  const menuToggle = document.querySelector("#menu-toggle");
  menuToggle.setAttribute(
    "aria-label",
    menuToggle.getAttribute("aria-expanded") === "true" ? text.menuClose : text.menuOpen
  );
}

function persistProgress() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      language: state.language,
      level: state.level,
      viewed: [...state.viewed],
      correct: state.correct,
      answered: state.answered,
      weaknesses: state.weaknesses
    }));
  } catch (error) {
    showToast(currentCopy().storageWarning);
  }
}

function showToast(message) {
  if (!dom.toast) return;
  dom.toast.textContent = message;
  dom.toast.classList.add("visible");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => dom.toast.classList.remove("visible"), 2600);
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function updateProgress() {
  const count = state.viewed.size;
  const percentage = Math.round((count / topics.length) * 100);
  document.querySelector("#hero-topics-count").textContent = `${count} / ${topics.length}`;
  document.querySelector("#hero-progress-fill").style.width = `${percentage}%`;
  document.querySelector("#quiz-score").textContent = `${state.correct} ${currentCopy().correctCount}`;
  document.querySelector("#quiz-answered").textContent = state.answered === 0
    ? currentCopy().answeredNone
    : `${state.answered} ${currentCopy().answeredSome}`;
  document.querySelector("#level-hint").textContent = currentCopy().levelHint[state.level];
  [...dom.levelSelect.options].forEach(option => {
    option.textContent = currentCopy().levels[option.value];
  });
  renderWeakTopics();
}

function topicText(topic, field) {
  if (state.language === "sheng") {
    const noteIndex = { simple: 0, example: 1, exam: 2 }[field];
    return shengNotes[topic.id][noteIndex];
  }
  const suffix = state.language === "sw" ? "Sw" : "";
  return topic[`${field}${suffix}`];
}

function renderWeakTopics() {
  const weak = Object.entries(state.weaknesses)
    .filter(([, record]) => record.attempts > 0 && record.missed > 0)
    .sort((first, second) => {
      const firstRate = first[1].missed / first[1].attempts;
      const secondRate = second[1].missed / second[1].attempts;
      return secondRate - firstRate || second[1].missed - first[1].missed;
    })
    .slice(0, 3);
  dom.weakTopics.replaceChildren();
  if (weak.length === 0) {
    dom.weakTopics.append(makeElement("p", "weak-empty", currentCopy().weakEmpty));
    return;
  }
  for (const [conceptId, record] of weak) {
    const topic = topics.find(item => item.id === conceptId);
    const questionIndex = quizDetails.findIndex(item => item.conceptId === conceptId);
    if (!topic || questionIndex < 0) continue;
    const item = makeElement("article", "weak-topic");
    item.append(makeElement("span", "weak-icon", topic.icon));
    const details = makeElement("div", "weak-copy");
    details.append(makeElement("strong", "", topicTitle(topic)));
    details.append(makeElement("span", "", `${record.missed} ${currentCopy().weakSummary} · ${record.attempts} ${currentCopy().answeredSome}`));
    item.append(details);
    const button = makeElement("button", "weak-review", currentCopy().retryTopic);
    button.type = "button";
    button.dataset.quizIndex = String(questionIndex);
    item.append(button);
    dom.weakTopics.append(item);
  }
}

function renderTopics() {
  const visibleTopics = topics.filter(topic => {
    const domainMatch = state.filter === "all" || topic.domain === state.filter;
    const query = state.search.trim().toLowerCase();
    const searchableText = `${topicTitle(topic)} ${topic.title} ${topic.keywords.join(" ")}`.toLowerCase();
    const searchMatch = !query || query.split(/\s+/).every(word => searchableText.includes(word));
    return domainMatch && searchMatch;
  });
  dom.topicGrid.replaceChildren();

  for (const topic of visibleTopics) {
    const card = makeElement("article", `topic-card domain-${topic.domain}`);
    const top = makeElement("div", "topic-card-top");
    top.append(makeElement("span", "topic-icon", topic.icon));
    const ui = currentUiCopy();
    const domainLabel = topic.domain === "cloud"
      ? ui.filterDomainCloud
      : topic.domain === "architecture" ? ui.filterDomainArchitecture : ui.filterDomainGovernance;
    top.append(makeElement("span", "topic-domain", domainLabel));
    if (state.viewed.has(topic.id)) top.append(makeElement("span", "topic-done", "✓"));
    card.append(top);
    card.append(makeElement("h3", "", topicTitle(topic)));
    card.append(makeElement("p", "", topicText(topic, "simple")));
    const button = makeElement("button", "topic-link", currentCopy().askAbout);
    button.type = "button";
    button.dataset.topicId = topic.id;
    button.append(makeElement("span", "", "→"));
    card.append(button);
    dom.topicGrid.append(card);
  }
  dom.emptyState.hidden = visibleTopics.length > 0;
  dom.topicGrid.hidden = visibleTopics.length === 0;
}

function appendChatMessage(kind, text) {
  const message = makeElement("div", `chat-message ${kind}`);
  if (kind === "buddy-message") message.append(makeElement("span", "message-avatar", "✳"));
  const bubble = makeElement("div", "message-bubble", text);
  message.append(bubble);
  dom.chatLog.append(message);
  dom.chatLog.scrollTop = dom.chatLog.scrollHeight;
  return message;
}

function showReviewedAnswer(topic, question) {
  state.answerRequestId += 1;
  state.lastQuestion = question;
  state.lastAnswer = { type: "topic", topicId: topic.id };
  state.simpleMode = false;
  state.simpleModeTopic = null;
  appendChatMessage("learner-message", question);
  state.viewed.add(topic.id);
  renderLastAnswer();
  updateProgress();
  renderTopics();
  persistProgress();
}

function localizedQuestion(index) {
  const question = questions[index];
  if (state.language === "sheng") return shengQuiz[index].prompt;
  return state.language === "sw" ? question.promptSw : question.prompt;
}

function createAnswerBlock(topic) {
  const answer = makeElement("article", "answer-card");
  answer.append(makeElement("h3", "", `${topic.icon} ${topicTitle(topic)}`));
  const levelCopy = currentCopy();
  const definition = topicText(topic, "simple");
  const simpleDefinition = definition.split(/(?<=[.!?])\s+/u, 1)[0];
  const isSimplified = state.simpleMode && state.simpleModeTopic === topic.id;
  const sections = [
    [levelCopy.explanation, isSimplified || state.level === "beginner" ? simpleDefinition : definition],
    [levelCopy.example, topicText(topic, "example")],
    [levelCopy.exam, topicText(topic, "exam")]
  ];
  for (const [label, body] of sections) {
    const section = makeElement("div", "answer-section");
    section.append(makeElement("strong", "", label));
    section.append(makeElement("p", "", body));
    answer.append(section);
  }
  const focusLabel = makeElement("strong", "answer-focus-label", levelCopy.levelFocus);
  const focus = makeElement("p", "answer-focus", levelCopy[`${state.level}Focus`]);
  const focusSection = makeElement("div", "answer-section answer-level-focus");
  focusSection.append(focusLabel, focus);
  answer.append(focusSection);

  const explainButton = makeElement("button", "explain-new-button", isSimplified ? levelCopy.explainFull : levelCopy.explainNew);
  explainButton.type = "button";
  explainButton.setAttribute("aria-pressed", String(isSimplified));
  explainButton.addEventListener("click", () => {
    state.simpleMode = !isSimplified;
    state.simpleModeTopic = topic.id;
    renderLastAnswer();
  });
  answer.append(explainButton);

  const matchingQuestion = quizDetails.findIndex(item => item.conceptId === topic.id);
  const check = makeElement("div", "answer-check");
  check.append(makeElement("strong", "", levelCopy.check));
  check.append(makeElement("p", "answer-check-prompt", localizedQuestion(matchingQuestion)));
  const checkLink = makeElement("button", "answer-check-link", levelCopy.quickCheck);
  checkLink.type = "button";
  checkLink.dataset.quizIndex = String(matchingQuestion >= 0 ? matchingQuestion : 0);
  checkLink.addEventListener("click", () => startRelatedQuiz(Number(checkLink.dataset.quizIndex)));
  check.append(checkLink);
  answer.append(check);
  return answer;
}

// Broad words that appear in many questions. On their own they are not enough to pick a topic.
const GENERIC_KEYWORDS = new Set([
  "cloud", "resource", "security", "file", "table", "network", "benefits", "policy",
  "region", "zones", "availability", "reliability", "storage", "compute", "monitor", "portal", "eneo"
]);
const IGNORED_TITLE_WORDS = new Set(["azure", "cloud", "and", "the", "with"]);
// A reviewed note is used only when the question clearly points at a topic; otherwise the AI tutor answers.
const MIN_TOPIC_SCORE = 3;

function findTopic(question) {
  // Pad with spaces so " keyword " only matches whole words ("arm" no longer matches "alarm").
  const padded = ` ${question.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ")} `;
  const has = phrase => padded.includes(` ${phrase} `);
  let best = null;
  let bestScore = 0;
  for (const topic of topics) {
    let score = 0;
    for (const keyword of topic.keywords) {
      if (!has(keyword)) continue;
      if (keyword.includes(" ")) score += 4;
      else score += GENERIC_KEYWORDS.has(keyword) ? 1 : 3;
    }
    for (const word of topic.title.toLowerCase().split(/[\s,&-]+/)) {
      if (word.length > 3 && !IGNORED_TITLE_WORDS.has(word) && has(word)) score += 1;
    }
    if (score > bestScore) {
      best = topic;
      bestScore = score;
    }
  }
  return bestScore >= MIN_TOPIC_SCORE ? best : null;
}

function answerQuestion(question) {
  const trimmed = question.trim();
  if (!trimmed) return;
  const topic = findTopic(trimmed);
  if (topic) {
    showReviewedAnswer(topic, trimmed);
    return;
  }
  state.lastQuestion = trimmed;
  state.lastAnswer = null;
  const requestId = ++state.answerRequestId;
  state.simpleMode = false;
  state.simpleModeTopic = null;
  appendChatMessage("learner-message", trimmed);

  if (!apiBaseUrl) {
    state.lastAnswer = { type: "not-found" };
    renderLastAnswer();
    return;
  }

  state.lastAnswer = { type: "loading" };
  renderLastAnswer();
  fetch(`${apiBaseUrl}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: trimmed,
      language: state.language,
      level: state.level
    })
  })
    .then(async response => {
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error("The AI service returned an unreadable response.");
        }
        throw error;
      }
      if (!response.ok) {
        throw new Error(typeof payload.detail === "string" ? payload.detail : currentCopy().aiError);
      }
      if (typeof payload.answer !== "string" || !payload.answer.trim()) {
        throw new Error("The AI service returned an empty answer.");
      }
      if (requestId === state.answerRequestId) {
        state.lastAnswer = { type: "ai", answer: payload.answer.trim() };
      }
    })
    .catch(error => {
      const message = error instanceof TypeError
        ? currentCopy().aiError
        : error.message || currentCopy().aiError;
      if (requestId === state.answerRequestId) {
        state.lastAnswer = { type: "error", message };
      }
    })
    .finally(() => {
      if (requestId === state.answerRequestId) renderLastAnswer();
    });
}

function renderLastAnswer() {
  dom.chatLog.querySelectorAll(
    ".buddy-message[data-answer-for], .buddy-message[data-not-found], .buddy-message[data-ai-answer], .buddy-message[data-ai-error], .buddy-message[data-ai-loading]"
  ).forEach(message => message.remove());
  if (!state.lastAnswer) return;
  if (state.lastAnswer.type === "topic") {
    const topic = topics.find(item => item.id === state.lastAnswer.topicId);
    if (!topic) return;
    const wrapper = makeElement("div", "chat-message buddy-message");
    wrapper.dataset.answerFor = topic.id;
    wrapper.append(makeElement("span", "message-avatar", "✳"));
    wrapper.append(createAnswerBlock(topic));
    dom.chatLog.append(wrapper);
    dom.chatLog.scrollTop = dom.chatLog.scrollHeight;
    return;
  }
  if (state.lastAnswer.type === "not-found") {
    const notFound = appendChatMessage("buddy-message", currentCopy().notFound);
    notFound.dataset.notFound = "true";
    return;
  }
  const wrapper = makeElement("div", "chat-message buddy-message");
  wrapper.dataset.aiAnswer = "true";
  wrapper.append(makeElement("span", "message-avatar", "✳"));
  const bubble = makeElement("div", "message-bubble ai-answer");
  if (state.lastAnswer.type === "loading") {
    wrapper.dataset.aiLoading = "true";
    bubble.textContent = currentCopy().aiLoading;
  } else if (state.lastAnswer.type === "error") {
    wrapper.dataset.aiError = "true";
    bubble.append(makeElement("p", "ai-answer-text", state.lastAnswer.message));
  } else {
    bubble.append(
      makeElement("strong", "ai-generated-label", currentCopy().aiLabel),
      makeElement("p", "ai-answer-text", state.lastAnswer.answer)
    );
  }
  wrapper.append(bubble);
  dom.chatLog.append(wrapper);
  dom.chatLog.scrollTop = dom.chatLog.scrollHeight;
}

function applyLanguage() {
  const text = currentCopy();
  translateStaticUi();
  document.documentElement.lang = state.language === "en" ? "en" : "sw";
  dom.languageSelect.value = state.language;
  dom.levelSelect.value = state.level;
  dom.questionInput.placeholder = text.askPlaceholder;
  dom.askForm.querySelector("button").firstChild.textContent = `${text.askButton} `;
  dom.chatLanguage.textContent = text.language;
  dom.capability.textContent = apiBaseUrl ? text.capabilityConnected : text.capabilityOffline;
  const privacyIcon = dom.privacyNote.querySelector("span");
  dom.privacyNote.replaceChildren(privacyIcon, document.createTextNode(text.privacyNotice));
  document.querySelector("#level-hint").textContent = text.levelHint[state.level];
  dom.emptyState.textContent = text.noResults;
  document.querySelector("#next-question").firstChild.textContent = `${state.quizComplete ? text.restart : state.quizIndex === questions.length - 1 ? text.finish : text.next} `;
  updateProgress();
  renderTopics();
  renderQuiz();
  if (state.lastQuestion) {
    renderLastAnswer();
  } else {
    const welcome = dom.chatLog.querySelector(".chat-welcome p");
    if (welcome) welcome.textContent = text.welcome;
  }
}

function renderQuiz() {
  const text = currentCopy();
  const nextButton = document.querySelector("#next-question");
  const feedback = document.querySelector("#answer-feedback");
  const progress = document.querySelector("#quiz-progress");
  if (state.quizComplete) {
    document.querySelector("#question-number").textContent = text.complete.toUpperCase();
    progress.style.width = "100%";
    dom.quizContent.replaceChildren(makeElement("p", "quiz-complete-message", `${text.complete} ${state.correct} ${text.correctCount}.`));
    feedback.textContent = "";
    nextButton.disabled = false;
    nextButton.firstChild.textContent = `${text.restart} `;
    return;
  }

  const question = questions[state.quizIndex];
  const prompt = state.language === "sheng"
    ? shengQuiz[state.quizIndex].prompt
    : state.language === "sw" ? question.promptSw : question.prompt;
  const options = state.language === "sheng"
    ? shengQuiz[state.quizIndex].options
    : state.language === "sw" ? question.optionsSw : question.options;
  const ui = currentUiCopy();
  document.querySelector("#question-number").textContent = `${ui.questionPrefix} ${state.quizIndex + 1} ${ui.questionOf} ${questions.length}`;
  progress.style.width = `${((state.quizIndex + 1) / questions.length) * 100}%`;
  const topicLabel = question.topic === "CLOUD CONCEPTS"
    ? ui.filterDomainCloud
    : question.topic === "AZURE ARCHITECTURE"
      ? ui.filterDomainArchitecture
      : question.topic === "SECURITY & GOVERNANCE" || question.topic === "MANAGEMENT & GOVERNANCE"
        ? ui.filterDomainGovernance
        : question.topic;
  dom.quizContent.replaceChildren(makeElement("p", "quiz-topic", topicLabel));
  dom.quizContent.append(makeElement("h3", "quiz-prompt", prompt));
  const choices = makeElement("div", "quiz-options");
  options.forEach((option, index) => {
    const button = makeElement("button", "quiz-option");
    button.type = "button";
    button.textContent = option;
    button.disabled = state.quizSelection !== null;
    if (state.quizSelection === index) button.classList.add(index === question.answer ? "is-correct" : "is-incorrect");
    else if (state.quizSelection !== null && index === question.answer) button.classList.add("is-correct");
    button.addEventListener("click", () => selectAnswer(index));
    choices.append(button);
  });
  dom.quizContent.append(choices);

  if (state.quizSelection === null) feedback.textContent = "";
  else {
    const explanation = state.language === "sheng"
      ? shengQuiz[state.quizIndex].explanation
      : state.language === "sw" ? question.explanationSw : question.explanation;
    feedback.textContent = `${state.quizSelection === question.answer ? text.correct : text.incorrect} ${explanation}`;
    const details = makeElement("details", "wrong-answer-details");
    details.append(makeElement("summary", "", text.wrongOptions));
    const reasons = makeElement("ul", "wrong-answer-list");
    const detail = quizDetails[state.quizIndex];
    const wrongReasons = wrongOptionReasons[state.language]?.[detail.conceptId] ?? detail.wrong;
    let wrongIndex = 0;
    options.forEach((option, index) => {
      if (index === question.answer) return;
      const item = makeElement("li", "", `${option}: ${wrongReasons[wrongIndex]}`);
      wrongIndex += 1;
      reasons.append(item);
    });
    details.append(reasons);
    dom.quizContent.append(details);
  }
  nextButton.disabled = state.quizSelection === null;
  nextButton.firstChild.textContent = `${state.quizIndex === questions.length - 1 ? text.finish : text.next} `;
}

function selectAnswer(index) {
  if (state.quizSelection !== null) return;
  state.quizSelection = index;
  state.answered += 1;
  const correct = index === questions[state.quizIndex].answer;
  const conceptId = quizDetails[state.quizIndex].conceptId;
  state.weaknesses[conceptId].attempts += 1;
  if (correct) state.correct += 1;
  else state.weaknesses[conceptId].missed += 1;
  renderQuiz();
  updateProgress();
  persistProgress();
}

function showTopicInBuddy(topicId) {
  const topic = topics.find(item => item.id === topicId);
  if (!topic) return;
  const question = state.language === "en" ? `Explain ${topic.title}` : `Nielezee ${topicTitle(topic)}`;
  showReviewedAnswer(topic, question);
  document.querySelector("#buddy").scrollIntoView({ behavior: "smooth", block: "start" });
}

function startRelatedQuiz(index) {
  if (!Number.isInteger(index) || index < 0 || index >= questions.length) return;
  state.quizIndex = index;
  state.quizSelection = null;
  state.quizComplete = false;
  renderQuiz();
  document.querySelector("#practice").scrollIntoView({ behavior: "smooth", block: "start" });
}

dom.askForm.addEventListener("submit", event => {
  event.preventDefault();
  const question = dom.questionInput.value;
  answerQuestion(question);
  dom.questionInput.value = "";
  dom.questionInput.focus();
});

document.querySelectorAll("[data-question]").forEach(button => {
  button.addEventListener("click", () => {
    const question = button.dataset.question;
    dom.questionInput.value = question;
    answerQuestion(question);
    dom.questionInput.value = "";
  });
});

dom.topicGrid.addEventListener("click", event => {
  const button = event.target.closest("[data-topic-id]");
  if (button) showTopicInBuddy(button.dataset.topicId);
});

dom.topicSearch.addEventListener("input", () => {
  state.search = dom.topicSearch.value;
  renderTopics();
});

dom.filterButtons.forEach(button => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    dom.filterButtons.forEach(filterButton => {
      const selected = filterButton === button;
      filterButton.classList.toggle("active", selected);
      filterButton.setAttribute("aria-pressed", String(selected));
    });
    renderTopics();
  });
});

dom.languageSelect.addEventListener("change", () => {
  state.language = ["en", "sw", "sheng"].includes(dom.languageSelect.value) ? dom.languageSelect.value : "en";
  persistProgress();
  applyLanguage();
});

dom.levelSelect.addEventListener("change", () => {
  state.level = ["beginner", "intermediate", "exam"].includes(dom.levelSelect.value) ? dom.levelSelect.value : "beginner";
  state.simpleMode = false;
  state.simpleModeTopic = null;
  persistProgress();
  applyLanguage();
});

dom.weakTopics.addEventListener("click", event => {
  const button = event.target.closest("[data-quiz-index]");
  if (button) startRelatedQuiz(Number(button.dataset.quizIndex));
});

document.querySelector("#next-question").addEventListener("click", () => {
  if (state.quizComplete) {
    state.quizIndex = 0;
    state.quizSelection = null;
    state.quizComplete = false;
  } else if (state.quizSelection !== null) {
    if (state.quizIndex === questions.length - 1) state.quizComplete = true;
    else {
      state.quizIndex += 1;
      state.quizSelection = null;
    }
  }
  renderQuiz();
});

document.querySelector("#reset-progress").addEventListener("click", () => {
  if (!window.confirm(currentCopy().resetConfirm)) {
    showToast(currentCopy().resetCancel);
    return;
  }
  state.viewed.clear();
  state.correct = 0;
  state.answered = 0;
  state.weaknesses = Object.fromEntries(quizDetails.map(({ conceptId }) => [conceptId, { attempts: 0, missed: 0 }]));
  state.quizIndex = 0;
  state.quizSelection = null;
  state.quizComplete = false;
  state.lastQuestion = "";
  state.lastAnswer = null;
  state.answerRequestId += 1;
  state.simpleMode = false;
  state.simpleModeTopic = null;
  const welcome = makeElement("div", "chat-welcome");
  welcome.append(makeElement("span", "welcome-spark", "✦"));
  welcome.append(makeElement("p", "", currentCopy().welcome));
  dom.chatLog.replaceChildren(welcome);
  persistProgress();
  updateProgress();
  renderTopics();
  renderQuiz();
  showToast(currentCopy().resetDone);
});

const menuToggle = document.querySelector("#menu-toggle");
const siteNav = document.querySelector("#site-nav");
menuToggle.addEventListener("click", () => {
  const expanded = menuToggle.getAttribute("aria-expanded") === "true";
  menuToggle.setAttribute("aria-expanded", String(!expanded));
  const ui = currentUiCopy();
  menuToggle.setAttribute("aria-label", expanded ? ui.menuOpen : ui.menuClose);
  siteNav.classList.toggle("is-open", !expanded);
});

siteNav.addEventListener("click", event => {
  if (event.target.closest("a")) {
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", currentUiCopy().menuOpen);
    siteNav.classList.remove("is-open");
  }
});

applyLanguage();

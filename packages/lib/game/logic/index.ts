import {
  GameStatus,
  RoundStatus,
  type CreateTriviaGameOptions,
  type JoinPlayer,
  type PlayerAnswer,
  type RoundResult,
  type ScoreAward,
  type TriviaGame,
  type TriviaGameState,
  type TriviaPlayer,
  type TriviaQuestion,
  type TriviaScore,
} from "../types";

const DefaultRoundDurationMs = 15000;
const DefaultPointsPerCorrect = 100;

export const TriviaQuestionSet: TriviaQuestion[] = [
  {
    id: "q-1",
    prompt: "Which planet is known as the Red Planet?",
    choices: ["Mercury", "Venus", "Earth", "Mars"],
    answerIndex: 3,
  },
  {
    id: "q-2",
    prompt: "What is the capital of Australia?",
    choices: ["Sydney", "Canberra", "Melbourne", "Perth"],
    answerIndex: 1,
  },
  {
    id: "q-3",
    prompt: "Which element has the chemical symbol O?",
    choices: ["Gold", "Oxygen", "Silver", "Iron"],
    answerIndex: 1,
  },
  {
    id: "q-4",
    prompt: "How many continents are there on Earth?",
    choices: ["Five", "Six", "Seven", "Eight"],
    answerIndex: 2,
  },
  {
    id: "q-5",
    prompt: "In which year did humans first land on the Moon?",
    choices: ["1965", "1969", "1972", "1976"],
    answerIndex: 1,
  },
  {
    id: "q-6",
    prompt: "Which ocean is the largest by surface area?",
    choices: ["Atlantic", "Pacific", "Indian", "Arctic"],
    answerIndex: 1,
  },
];

/**
 * Picks a randomized subset of questions using the provided RNG.
 */
export function selectTriviaQuestions(
  questions: TriviaQuestion[],
  count: number,
  random: () => number,
): TriviaQuestion[] {
  if (!questions.length) {
    throw new Error("Question set is required");
  }
  if (count <= 0) {
    throw new Error("Question count must be positive");
  }

  const normalizedCount = Math.min(count, questions.length);
  const shuffled = questions.map(cloneQuestion);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = current;
  }
  return shuffled.slice(0, normalizedCount);
}

/**
 * Builds a trivia game state machine with injected timing/randomness.
 */
export function createTriviaGame(options: CreateTriviaGameOptions): TriviaGame {
  const roomCode = options.roomCode.trim();
  if (!roomCode) {
    throw new Error("Room code is required");
  }

  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const roundDurationMs = options.roundDurationMs ?? DefaultRoundDurationMs;
  const pointsPerCorrect = options.pointsPerCorrect ?? DefaultPointsPerCorrect;
  const roomPassword = options.roomPassword?.trim();
  const questionSet = options.questions ?? TriviaQuestionSet;
  const questionCount = options.questionCount ?? questionSet.length;

  if (!questionSet.length) {
    throw new Error("Question set is required");
  }
  if (questionCount <= 0) {
    throw new Error("Question count must be positive");
  }

  const state: TriviaGameState = {
    roomCode,
    status: GameStatus.Lobby,
    roundStatus: RoundStatus.Idle,
    round: 0,
    selectedQuestions: [],
    players: [],
    scores: [],
  };

  const answersByPlayer = new Map<string, PlayerAnswer>();

  const getState = (): TriviaGameState => cloneState(state);

  const canJoin = (password?: string): boolean => {
    if (!roomPassword) {
      return true;
    }
    return password?.trim() === roomPassword;
  };

  const joinPlayer = (player: JoinPlayer, password?: string): TriviaPlayer => {
    ensureJoinAllowed(player, password);
    const timestamp = now();
    const existing = state.players.find((entry) => entry.id === player.id);
    if (existing) {
      existing.name = player.name;
      existing.connected = true;
      existing.leftAt = undefined;
      return { ...existing };
    }

    const record: TriviaPlayer = {
      id: player.id,
      name: player.name,
      joinedAt: timestamp,
      connected: true,
    };
    state.players.push(record);
    ensureScoreRecord(player.id, timestamp);
    return { ...record };
  };

  const leavePlayer = (playerId: string): TriviaPlayer | null => {
    const player = state.players.find((entry) => entry.id === playerId);
    if (!player) {
      return null;
    }
    player.connected = false;
    player.leftAt = now();
    return { ...player };
  };

  const startGame = (): TriviaGameState => {
    if (state.status !== GameStatus.Lobby) {
      throw new Error("Game already started");
    }
    if (!state.players.length) {
      throw new Error("At least one player is required");
    }

    state.status = GameStatus.InProgress;
    state.startedAt = now();
    state.round = 0;
    state.roundStatus = RoundStatus.Idle;
    state.roundEndsAt = undefined;
    state.currentQuestion = undefined;
    state.lastRoundResult = undefined;
    state.selectedQuestions = selectTriviaQuestions(
      questionSet,
      questionCount,
      random,
    );
    answersByPlayer.clear();

    return getState();
  };

  const startRound = (): TriviaGameState => {
    if (state.status !== GameStatus.InProgress) {
      throw new Error("Game is not active");
    }
    if (state.roundStatus === RoundStatus.Active) {
      throw new Error("Round already active");
    }
    if (state.round >= state.selectedQuestions.length) {
      throw new Error("No questions remaining");
    }

    const question = state.selectedQuestions[state.round];
    state.round += 1;
    state.roundStatus = RoundStatus.Active;
    state.currentQuestion = question;
    state.roundEndsAt = now() + roundDurationMs;
    state.lastRoundResult = undefined;
    answersByPlayer.clear();

    return getState();
  };

  const submitAnswer = (playerId: string, choiceIndex: number): boolean => {
    if (state.roundStatus !== RoundStatus.Active) {
      return false;
    }
    if (!state.currentQuestion) {
      return false;
    }
    if (state.roundEndsAt !== undefined && now() > state.roundEndsAt) {
      return false;
    }
    const player = state.players.find(
      (entry) => entry.id === playerId && entry.connected,
    );
    if (!player) {
      return false;
    }
    if (answersByPlayer.has(playerId)) {
      return false;
    }
    if (
      !Number.isInteger(choiceIndex) ||
      choiceIndex < 0 ||
      choiceIndex >= state.currentQuestion.choices.length
    ) {
      return false;
    }

    answersByPlayer.set(playerId, {
      playerId,
      choiceIndex,
      submittedAt: now(),
    });
    return true;
  };

  const endRound = (): RoundResult => {
    if (state.roundStatus !== RoundStatus.Active) {
      throw new Error("No active round");
    }
    if (!state.currentQuestion) {
      throw new Error("No question is active");
    }

    const correctChoiceIndex = state.currentQuestion.answerIndex;
    const awards: ScoreAward[] = [];
    const timestamp = now();

    for (const answer of answersByPlayer.values()) {
      if (answer.choiceIndex !== correctChoiceIndex) {
        continue;
      }
      awards.push(awardPoints(answer.playerId, pointsPerCorrect, timestamp));
    }

    state.roundStatus = RoundStatus.Complete;
    state.roundEndsAt = undefined;
    state.lastRoundResult = {
      questionId: state.currentQuestion.id,
      correctChoiceIndex,
      awards,
    };
    answersByPlayer.clear();

    if (state.round >= state.selectedQuestions.length) {
      state.status = GameStatus.Completed;
      state.endedAt = now();
    }

    return state.lastRoundResult;
  };

  const endGame = (): TriviaGameState => {
    if (state.status === GameStatus.Completed) {
      return getState();
    }
    if (state.status === GameStatus.Lobby) {
      throw new Error("Game has not started");
    }
    if (state.roundStatus === RoundStatus.Active) {
      endRound();
    }
    state.status = GameStatus.Completed;
    state.endedAt = now();
    state.roundStatus = RoundStatus.Complete;
    state.roundEndsAt = undefined;
    return getState();
  };

  const tick = (): TriviaGameState => {
    if (
      state.roundStatus === RoundStatus.Active &&
      state.roundEndsAt !== undefined &&
      now() >= state.roundEndsAt
    ) {
      endRound();
    }
    return getState();
  };

  const ensureJoinAllowed = (player: JoinPlayer, password?: string): void => {
    if (!player.id.trim()) {
      throw new Error("Player id is required");
    }
    if (!player.name.trim()) {
      throw new Error("Player name is required");
    }
    if (state.status === GameStatus.Completed) {
      throw new Error("Game has ended");
    }
    if (!canJoin(password)) {
      throw new Error("Invalid room password");
    }
  };

  const ensureScoreRecord = (
    playerId: string,
    timestamp: number,
  ): TriviaScore => {
    const existing = state.scores.find((entry) => entry.playerId === playerId);
    if (existing) {
      return existing;
    }
    const record: TriviaScore = {
      playerId,
      score: 0,
      updatedAt: timestamp,
    };
    state.scores.push(record);
    return record;
  };

  const awardPoints = (
    playerId: string,
    points: number,
    timestamp: number,
  ): ScoreAward => {
    const record = ensureScoreRecord(playerId, timestamp);
    record.score += points;
    record.updatedAt = timestamp;
    return {
      playerId,
      points,
      totalScore: record.score,
    };
  };

  return {
    getState,
    canJoin,
    joinPlayer,
    leavePlayer,
    startGame,
    startRound,
    submitAnswer,
    endRound,
    endGame,
    tick,
  };
}

function cloneQuestion(question: TriviaQuestion): TriviaQuestion {
  return {
    id: question.id,
    prompt: question.prompt,
    choices: [...question.choices],
    answerIndex: question.answerIndex,
  };
}

function cloneState(state: TriviaGameState): TriviaGameState {
  let lastRoundResult: RoundResult | undefined;
  if (state.lastRoundResult) {
    lastRoundResult = {
      ...state.lastRoundResult,
      awards: state.lastRoundResult.awards.map((award) => ({ ...award })),
    };
  }

  return {
    ...state,
    currentQuestion: state.currentQuestion
      ? cloneQuestion(state.currentQuestion)
      : undefined,
    selectedQuestions: state.selectedQuestions.map(cloneQuestion),
    players: state.players.map((player) => ({ ...player })),
    scores: state.scores.map((score) => ({ ...score })),
    lastRoundResult,
  };
}

export const enum GameStatus {
  Lobby = "Lobby",
  InProgress = "InProgress",
  Completed = "Completed",
}

export const enum RoundStatus {
  Idle = "Idle",
  Active = "Active",
  Complete = "Complete",
}

export interface TriviaQuestion {
  id: string;
  prompt: string;
  choices: string[];
  answerIndex: number;
}

export interface TriviaPlayer {
  id: string;
  name: string;
  joinedAt: number;
  connected: boolean;
  leftAt?: number;
}

export interface TriviaScore {
  playerId: string;
  score: number;
  updatedAt: number;
}

export interface PlayerAnswer {
  playerId: string;
  choiceIndex: number;
  submittedAt: number;
}

export interface ScoreAward {
  playerId: string;
  points: number;
  totalScore: number;
}

export interface RoundResult {
  questionId: string;
  correctChoiceIndex: number;
  awards: ScoreAward[];
}

export interface TriviaGameState {
  roomCode: string;
  status: GameStatus;
  roundStatus: RoundStatus;
  round: number;
  roundEndsAt?: number;
  currentQuestion?: TriviaQuestion;
  selectedQuestions: TriviaQuestion[];
  players: TriviaPlayer[];
  scores: TriviaScore[];
  lastRoundResult?: RoundResult;
  startedAt?: number;
  endedAt?: number;
}

export interface CreateTriviaGameOptions {
  roomCode: string;
  roomPassword?: string;
  questions?: TriviaQuestion[];
  questionCount?: number;
  roundDurationMs?: number;
  pointsPerCorrect?: number;
  now?: () => number;
  random?: () => number;
}

export interface JoinPlayer {
  id: string;
  name: string;
}

export interface TriviaGame {
  getState: () => TriviaGameState;
  canJoin: (password?: string) => boolean;
  joinPlayer: (player: JoinPlayer, password?: string) => TriviaPlayer;
  leavePlayer: (playerId: string) => TriviaPlayer | null;
  startGame: () => TriviaGameState;
  startRound: () => TriviaGameState;
  submitAnswer: (playerId: string, choiceIndex: number) => boolean;
  endRound: () => RoundResult;
  endGame: () => TriviaGameState;
  tick: () => TriviaGameState;
}

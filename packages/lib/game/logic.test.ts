import { describe, expect, it } from "bun:test";
import {
  createTriviaGame,
  selectTriviaQuestions,
  TriviaQuestionSet,
} from "./logic";
import { GameStatus, RoundStatus } from "./types";

function createSequenceRandom(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length];
    index += 1;
    return value;
  };
}

describe("game logic", () => {
  it("validates game lifecycle transitions", () => {
    let now = 1000;
    const game = createTriviaGame({
      roomCode: "Room 5",
      questionCount: 2,
      now: () => now,
      random: createSequenceRandom([0.7, 0.3, 0.9, 0.1]),
    });

    game.joinPlayer({ id: "p-1", name: "Ada" });

    let state = game.startGame();
    expect(state.status).toBe(GameStatus.InProgress);
    expect(state.round).toBe(0);

    state = game.startRound();
    expect(state.roundStatus).toBe(RoundStatus.Active);
    expect(state.round).toBe(1);

    game.endRound();
    state = game.getState();
    expect(state.roundStatus).toBe(RoundStatus.Complete);
    expect(state.status).toBe(GameStatus.InProgress);

    state = game.startRound();
    expect(state.round).toBe(2);

    game.endRound();
    state = game.getState();
    expect(state.status).toBe(GameStatus.Completed);
  });

  it("applies scoring rules for correct answers", () => {
    let now = 2000;
    const game = createTriviaGame({
      roomCode: "Room Score",
      questionCount: 1,
      pointsPerCorrect: 50,
      now: () => now,
      random: createSequenceRandom([0.2, 0.8, 0.4]),
    });

    game.joinPlayer({ id: "p-1", name: "Ada" });
    game.joinPlayer({ id: "p-2", name: "Byron" });

    game.startGame();
    game.startRound();

    const question = game.getState().currentQuestion!;
    expect(game.submitAnswer("p-1", question.answerIndex)).toBe(true);
    expect(
      game.submitAnswer(
        "p-2",
        (question.answerIndex + 1) % question.choices.length,
      ),
    ).toBe(true);

    const result = game.endRound();
    expect(result.awards).toEqual([
      { playerId: "p-1", points: 50, totalScore: 50 },
    ]);

    const scores = game.getState().scores;
    expect(scores.find((score) => score.playerId === "p-1")?.score).toBe(50);
    expect(scores.find((score) => score.playerId === "p-2")?.score).toBe(0);
  });

  it("selects questions from the static JSON set", () => {
    const expected = selectTriviaQuestions(
      TriviaQuestionSet,
      3,
      createSequenceRandom([0.9, 0.1, 0.4, 0.7]),
    );

    const game = createTriviaGame({
      roomCode: "Room Q",
      questionCount: 3,
      random: createSequenceRandom([0.9, 0.1, 0.4, 0.7]),
    });

    game.joinPlayer({ id: "p-1", name: "Ada" });

    const state = game.startGame();
    const selectedIds = state.selectedQuestions.map((question) => question.id);

    for (const question of state.selectedQuestions) {
      expect(TriviaQuestionSet.some((entry) => entry.id === question.id)).toBe(
        true,
      );
    }

    expect(selectedIds).toEqual(expected.map((question) => question.id));
  });

  it("transitions when the round timer expires", () => {
    let now = 0;
    const game = createTriviaGame({
      roomCode: "Room Timer",
      questionCount: 2,
      roundDurationMs: 1000,
      now: () => now,
      random: createSequenceRandom([0.1, 0.2, 0.3]),
    });

    game.joinPlayer({ id: "p-1", name: "Ada" });

    game.startGame();
    game.startRound();

    now = 1500;
    expect(game.submitAnswer("p-1", 0)).toBe(false);

    const state = game.tick();
    expect(state.roundStatus).toBe(RoundStatus.Complete);
    expect(state.status).toBe(GameStatus.InProgress);
    expect(state.lastRoundResult).toBeDefined();
  });

  it("requires a password when set and tracks join/leave", () => {
    let now = 500;
    const game = createTriviaGame({
      roomCode: "Room Lock",
      roomPassword: "secret",
      now: () => now,
    });

    expect(game.canJoin("nope")).toBe(false);
    expect(() => game.joinPlayer({ id: "p-1", name: "Ada" }, "nope")).toThrow(
      "Invalid room password",
    );

    const player = game.joinPlayer({ id: "p-1", name: "Ada" }, "secret");
    expect(player.connected).toBe(true);

    now = 900;
    game.leavePlayer("p-1");

    const updated = game.getState().players.find((entry) => entry.id === "p-1");
    expect(updated?.connected).toBe(false);
    expect(updated?.leftAt).toBe(900);
  });
});

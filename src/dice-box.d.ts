declare module "@3d-dice/dice-box" {
  export interface DieResult {
    groupId: number;
    rollId: number;
    sides: number;
    value: number;
  }
  export default class DiceBox {
    constructor(config: Record<string, unknown>);
    init(): Promise<DiceBox>;
    roll(notation: unknown): Promise<DieResult[]>;
    clear(): DiceBox;
    resizeWorld(): void;
  }
}

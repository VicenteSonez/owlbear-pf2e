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
    roll(notation: unknown, options?: { theme?: string; themeColor?: string }): Promise<DieResult[]>;
    loadTheme(theme: string): Promise<unknown>;
    updateConfig(config: Record<string, unknown>): Promise<DiceBox>;
    clear(): DiceBox;
    resizeWorld(): void;
  }
}

export const ITERATIONS: number;
export function hashPassword(password: string, salt?: Uint8Array): Promise<{ hash: string; salt: string }>;
export function passwordProblem(password: string): string | null;
export function sqlText(value: string): string;
export function sha256HexUpper(text: string): Promise<string>;
export function buildUpdateSql(email: string, password: { hash: string; salt: string }): Promise<string>;

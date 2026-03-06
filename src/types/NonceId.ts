const MAX_U32 = 0xFFFFFFFF; // 4294967295

export class NonceId {
    private constructor(public readonly value: number) {}

    public static validate(value: number): boolean {
        return value >= 0 && value <= MAX_U32;
    }

    public static fromNumber(value: number): NonceId | null {
        if (!NonceId.validate(value)) {
            return null;
        }
        return new NonceId(value);
    }

    public static random(): NonceId {
        return new NonceId(Math.floor(Math.random() * MAX_U32));
    }
}

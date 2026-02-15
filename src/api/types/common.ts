export interface ApiResponse<T> {
    code: number;
    data: T;
}

export class WarthogApiError extends Error {
    constructor(
        public readonly code: number,
        public readonly endpoint: string,
        message?: string,
    ) {
        super(message ?? `Warthog API error code ${code} on ${endpoint}`);
    }
}

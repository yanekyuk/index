export interface SynthesisGeneratorInput {
    initiator: string;
    target: string;
    targetIntro: string;
    isThirdPerson?: boolean;
    intentPairs: {
        contextUserIntent: {
            id: string;
            payload: string;
            createdAt: Date | string;
        };
        targetUserIntent: {
            id: string;
            payload: string;
            createdAt: Date | string;
        };
    }[];
    characterLimit?: number;
}

export interface SynthesisGeneratorResult {
    subject: string;
    body: string;
}

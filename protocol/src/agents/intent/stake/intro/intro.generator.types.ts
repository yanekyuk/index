export interface IntroGeneratorInput {
  sender: {
    name: string;
    reasonings: string[];
  };
  recipient: {
    name: string;
    reasonings: string[];
  };
}

export interface IntroGeneratorResult {
  synthesis: string;
}

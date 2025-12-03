
export interface MockUser {
    id: string;
    name: string;
    bio: string;
}

export const MOCK_USERS: MockUser[] = [
    {
        id: "user_1",
        name: "Alice (Rust Dev)",
        bio: "I've been building distributed systems in Rust for the last 5 years. Really interested in privacy-preserving computation and zero-knowledge proofs. Looking for projects that are trying to solve the scalability trilemma without compromising on decentralization."
    },
    {
        id: "user_2",
        name: "Bob (Privacy Researcher)",
        bio: "PhD student focusing on cryptography and privacy. I'm working on a new protocol for private intent discovery. I need to find engineers who understand low-level systems programming to help me prototype this. Big fan of Rust."
    },
    {
        id: "user_3",
        name: "Charlie (Designer)",
        bio: "Product designer with a passion for web3 user experience. I think crypto apps are too hard to use. I want to simplify the onboarding flow for DeFi protocols. Looking for frontend devs to partner with."
    }
];

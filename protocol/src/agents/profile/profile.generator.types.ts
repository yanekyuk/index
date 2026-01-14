export interface UserProfileIdentity {
    name: string;
    bio: string;
    location?: string;
}

export interface UserProfileNarrative {
    context: string;
    // TODO: (@yanekyuk) Remove aspirations
    aspirations: string;
}

export interface UserProfileAttributes {
    interests: string[];
    skills: string[];
}

export interface UserProfile {
    identity: UserProfileIdentity;
    narrative: UserProfileNarrative;
    attributes: UserProfileAttributes;
}

export interface ProfileGeneratorOutput {
    profile: UserProfile;
}

export interface ProfileGeneratorAgent {
    run(parallelData: any): Promise<ProfileGeneratorOutput>;
}

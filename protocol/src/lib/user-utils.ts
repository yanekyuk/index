import db from './drizzle/drizzle';
import { users } from '../schemas/database.schema';
import { eq } from 'drizzle-orm';
import { log } from './log';
import type { IntegrationName } from './integrations/config';

const logger = log.lib.from("lib/user-utils.ts");

export interface ExtractedUser {
  email: string;
  name: string;
  provider: IntegrationName;
  providerId: string;
  avatar?: string;
}

export interface CreatedUser {
  id: string;
  email: string;
  name: string;
  isNewUser: boolean;
}

/**
 * Save or find a single user by email
 */
export async function saveUser(extractedUser: ExtractedUser): Promise<CreatedUser> {
  try {
    const existingUser = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name
      })
      .from(users)
      .where(eq(users.email, extractedUser.email))
      .limit(1);
    
    if (existingUser.length > 0) {
      const user = existingUser[0];
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        isNewUser: false
      };
    }
    
    logger.info('Creating user in database', { 
      email: extractedUser.email,
      provider: extractedUser.provider,
    });
    
    const newUser = await db
      .insert(users)
      .values({
        email: extractedUser.email,
        name: extractedUser.name,
        intro: null,
        avatar: extractedUser.avatar || null,
        onboarding: {}
      })
      .returning({
        id: users.id,
        email: users.email,
        name: users.name
      });
    
    const user = newUser[0];
    logger.info('Successfully created user', { 
      userId: user.id,
      email: user.email,
      provider: extractedUser.provider 
    });
    
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isNewUser: true
    };
    
  } catch (error) {
    logger.error('Failed to create user', { 
      email: extractedUser.email,
      provider: extractedUser.provider,
      error: error instanceof Error ? error.message : String(error) 
    });
    
    if (error instanceof Error && error.message.includes('23505')) {
      const existingUser = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name
        })
        .from(users)
        .where(eq(users.email, extractedUser.email))
        .limit(1);
      
      if (existingUser.length > 0) {
        const user = existingUser[0];
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          isNewUser: false
        };
      }
    }
    
    throw error;
  }
}

/**
 * User resolver for file-based imports (CSV, etc).
 * Finds existing user by email or creates a new one.
 */
export async function resolveFileUser(params: {
  email: string;
  name: string;
  avatar?: string;
  intro?: string;
  location?: string;
  socials?: {
    x?: string;
    linkedin?: string;
    github?: string;
    websites?: string[];
  };
}): Promise<CreatedUser | undefined> {
  const { email, name, avatar, intro, location, socials } = params;
  
  try {
    const existingUser = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        intro: users.intro,
        avatar: users.avatar,
        location: users.location,
        socials: users.socials
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    
    if (existingUser.length > 0) {
      const user = existingUser[0];
      logger.info('File import user already exists', { email, userId: user.id });
      
      const updates: any = {};
      
      if (name && (!user.name || user.name.trim() === '')) {
        updates.name = name;
      }
      if (intro && !user.intro) {
        updates.intro = intro;
      }
      if (avatar && !user.avatar) {
        updates.avatar = avatar;
      }
      if (location && !user.location) {
        updates.location = location;
      }
      
      if (socials) {
        const currentSocials = (user.socials as any) || {};
        const updatedSocials = { ...currentSocials };
        let socialsChanged = false;
        
        if (socials.x && !currentSocials.x) {
          updatedSocials.x = socials.x;
          socialsChanged = true;
        }
        if (socials.linkedin && !currentSocials.linkedin) {
          updatedSocials.linkedin = socials.linkedin;
          socialsChanged = true;
        }
        if (socials.github && !currentSocials.github) {
          updatedSocials.github = socials.github;
          socialsChanged = true;
        }
        if (socials.websites && (!currentSocials.websites || currentSocials.websites.length === 0)) {
          updatedSocials.websites = socials.websites;
          socialsChanged = true;
        }
        
        if (socialsChanged) {
          updates.socials = updatedSocials;
        }
      }
      
      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date();
        
        const updatedUser = await db
          .update(users)
          .set(updates)
          .where(eq(users.id, user.id))
          .returning({
            id: users.id,
            email: users.email,
            name: users.name
          });
        
        logger.info('Updated existing user with missing data from file import', { 
          email,
          userId: user.id,
          updatedFields: Object.keys(updates)
        });
        
        if (updatedUser.length > 0) {
          return {
            id: updatedUser[0].id,
            email: updatedUser[0].email,
            name: updatedUser[0].name,
            isNewUser: false
          };
        }
      }
      
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        isNewUser: false
      };
    }
    
    const createdUser = await saveUser({
      email,
      name,
      provider: 'file' as any,
      providerId: email,
      avatar
    });
    
    if (intro || location || socials) {
      const updateData: any = { updatedAt: new Date() };
      if (intro) updateData.intro = intro;
      if (location) updateData.location = location;
      if (socials) updateData.socials = socials;
      
      await db.update(users)
        .set(updateData)
        .where(eq(users.id, createdUser.id));
    }
    
    return createdUser;
  } catch (error) {
    logger.error('Failed to resolve file user', { 
      email, 
      error: error instanceof Error ? error.message : String(error) 
    });
    return undefined;
  }
}

/**
 * Generic user resolver for integration providers.
 * Finds existing user by email or creates a new one.
 */
export async function resolveIntegrationUser(params: {
  email: string;
  providerId: string;
  name: string;
  provider: IntegrationName;
  avatar?: string;
  updateEmptyFields?: boolean;
}): Promise<CreatedUser | undefined> {
  const { email, providerId, name, provider, avatar, updateEmptyFields = false } = params;
  
  try {
    const existingUser = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        avatar: users.avatar
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    
    if (existingUser.length > 0) {
      const user = existingUser[0];
      
      if (updateEmptyFields) {
        const needsUpdate = (!user.name || user.name.trim() === '') || (avatar && !user.avatar);
        
        if (needsUpdate) {
          const updateData: any = {};
          if (!user.name || user.name.trim() === '') {
            updateData.name = name;
          }
          if (avatar && !user.avatar) {
            updateData.avatar = avatar;
          }
          
          if (Object.keys(updateData).length > 0) {
            updateData.updatedAt = new Date();
            
            const updatedUser = await db
              .update(users)
              .set(updateData)
              .where(eq(users.id, user.id))
              .returning({
                id: users.id,
                email: users.email,
                name: users.name
              });
            
            if (updatedUser.length > 0) {
              logger.info('Updated existing user with missing data', { 
                email,
                provider,
                providerId,
                userId: user.id,
                updatedFields: Object.keys(updateData)
              });
              
              return {
                id: updatedUser[0].id,
                email: updatedUser[0].email,
                name: updatedUser[0].name,
                isNewUser: false
              };
            }
          }
        }
      }
      
      logger.debug('Integration user already exists', { email, provider, providerId, userId: user.id });
      
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        isNewUser: false
      };
    }
    
    const createdUser = await saveUser({
      email,
      name,
      provider,
      providerId,
      avatar
    });
    
    return createdUser;
  } catch (error) {
    logger.error('Failed to resolve integration user', { 
      email, 
      provider, 
      providerId, 
      error: error instanceof Error ? error.message : String(error) 
    });
    return undefined;
  }
}

import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';
import { Controller, Post, UseGuards } from '../lib/router/router.decorators';
import { intentService } from '../services/intent.service';
import { userService } from '../services/user.service';

const logger = log.controller.from('intent');

@Controller('/intents')
export class IntentController {
  /**
   * Processes user input through the Intent Graph.
   * Extracts, verifies, reconciles, and executes intent actions.
   * 
   * @param req - The HTTP request object (body: { content?: string })
   * @param user - The authenticated user from AuthGuard
   * @returns JSON response with graph execution result
   */
  @Post('/process')
  @UseGuards(AuthGuard)
  async process(req: Request, user: AuthenticatedUser) {
    logger.info('Intent process requested', { userId: user.id });
    
    // 1. Parse request body for content
    let content: string | undefined;
    try {
      const body = await req.json() as { content?: string };
      content = body.content;
    } catch {
      // No body or invalid JSON - content remains undefined
    }

    // 2. Fetch user profile
    const userWithGraph = await userService.findWithGraph(user.id);
    const userProfile = userWithGraph?.profile ? JSON.stringify(userWithGraph.profile) : '{}';

    // 3. Process through service
    const result = await intentService.processIntent(user.id, userProfile, content);

    // 4. Return result
    return Response.json(result);
  }
}

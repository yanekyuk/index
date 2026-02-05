import { log } from '../log';

const logger = log.lib.from('RouteRegistry');

export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

// Validation guard signature
export type Guard = (req: Request) => Promise<unknown>;

export interface RouteDefinition {
  path: string;
  method: Method;
  methodName: string | symbol;
}

export interface ControllerDefinition {
  path: string;
  target: Function; // Constructor
}

export class RouteRegistry {
  private static routes: Map<Function, RouteDefinition[]> = new Map();
  private static controllers: Map<Function, ControllerDefinition> = new Map();
  private static guards: Map<Function, Map<string | symbol, Guard[]>> = new Map();

  static registerController(target: Function, path: string) {
    this.controllers.set(target, { path, target });
    logger.info('Controller registered', { controller: target.name, path });
  }

  static registerRoute(target: object, method: Method, path: string, methodName: string | symbol) {
    const constructor = target.constructor;
    if (!this.routes.has(constructor)) {
      this.routes.set(constructor, []);
    }
    const routes = this.routes.get(constructor)!;
    routes.push({ path, method, methodName });
    logger.debug('Route registered', {
      controller: (constructor as Function).name,
      method,
      path: path || '/',
      handler: String(methodName),
    });
  }

  static registerGuard(target: object, methodName: string | symbol, guard: Guard) {
    const constructor = target.constructor;
    if (!this.guards.has(constructor)) {
      this.guards.set(constructor, new Map());
    }
    const methodGuards = this.guards.get(constructor)!;
    if (!methodGuards.has(methodName)) {
      methodGuards.set(methodName, []);
    }
    methodGuards.get(methodName)!.push(guard);
    logger.debug('Guard registered', {
      controller: (constructor as Function).name,
      method: String(methodName),
      guard: guard.name || 'anonymous',
    });
  }

  static getControllers() {
    return this.controllers;
  }

  static getRoutes(target: Function) {
    return this.routes.get(target) || [];
  }

  static getGuards(target: Function, methodName: string | symbol): Guard[] {
    const constructorGuards = this.guards.get(target);
    if (!constructorGuards) return [];
    return constructorGuards.get(methodName) || [];
  }
}

export function Controller(prefix: string = ''): ClassDecorator {
  return (target: Function) => {
    RouteRegistry.registerController(target, prefix);
  };
}

export function Post(path: string = ''): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    RouteRegistry.registerRoute(target, 'POST', path, propertyKey);
  };
}

export function Get(path: string = ''): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    RouteRegistry.registerRoute(target, 'GET', path, propertyKey);
  };
}

export function Put(path: string = ''): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    RouteRegistry.registerRoute(target, 'PUT', path, propertyKey);
  };
}

export function Delete(path: string = ''): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    RouteRegistry.registerRoute(target, 'DELETE', path, propertyKey);
  };
}

export function Patch(path: string = ''): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    RouteRegistry.registerRoute(target, 'PATCH', path, propertyKey);
  };
}

export function UseGuards(...guards: Guard[]): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    for (const guard of guards) {
      RouteRegistry.registerGuard(target, propertyKey, guard);
    }
  };
}

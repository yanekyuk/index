import { timed } from "./performance.wrapper";

export function Timed(): (target: any, propertyKey: string, descriptor: PropertyDescriptor) => void {
  return function (_target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const original = descriptor.value;
    descriptor.value = function (this: any, ...args: any[]) {
      const className = this.constructor.name;
      const name = `${className}.${propertyKey}`;
      return timed(name, () => original.apply(this, args));
    };
  };
}

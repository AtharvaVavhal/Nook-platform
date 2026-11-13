import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod, type INestApplicationContext } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';

export interface RouteInfo {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path under the API prefix, e.g. `/bookings/:id/extend`. */
  readonly path: string;
  readonly controller: string;
  readonly handler: string;
  readonly target: object;
  readonly handlerFn: (...args: never[]) => unknown;
}

const METHODS: Partial<Record<RequestMethod, RouteInfo['method']>> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
};

const join = (...parts: string[]) =>
  '/' +
  parts
    .flatMap((p) => p.split('/'))
    .filter(Boolean)
    .join('/');

/**
 * Every HTTP route registered by the application, discovered from the framework's own metadata so a route
 * added later is covered automatically. Routes with an HTTP method this helper does not know are reported
 * (method 'UNSUPPORTED:<n>') rather than silently skipped, so the completeness test cannot be bypassed.
 */
export function listRoutes(app: INestApplicationContext): RouteInfo[] {
  const routes: RouteInfo[] = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const instance = wrapper.instance as object | undefined;
      const metatype = wrapper.metatype as (new (...args: never[]) => object) | null;
      if (!instance || !metatype) continue;
      const base = Reflect.getMetadata(PATH_METADATA, metatype) as string | string[] | undefined;
      const basePath = Array.isArray(base) ? (base[0] ?? '') : (base ?? '');
      for (const name of Object.getOwnPropertyNames(metatype.prototype)) {
        if (name === 'constructor') continue;
        const handlerFn = (metatype.prototype as Record<string, unknown>)[name];
        if (typeof handlerFn !== 'function') continue;
        const verb = Reflect.getMetadata(METHOD_METADATA, handlerFn) as RequestMethod | undefined;
        if (verb === undefined) continue;
        const sub = Reflect.getMetadata(PATH_METADATA, handlerFn) as string | string[] | undefined;
        const subPath = Array.isArray(sub) ? (sub[0] ?? '') : (sub ?? '');
        routes.push({
          method: (METHODS[verb] ?? `UNSUPPORTED:${verb}`) as RouteInfo['method'],
          path: join(basePath, subPath),
          controller: metatype.name,
          handler: name,
          target: metatype,
          handlerFn: handlerFn as RouteInfo['handlerFn'],
        });
      }
    }
  }
  return routes.sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}

/** A fixed, well-formed UUID substituted for every path parameter, so requests are deterministic. */
export const FIXED_UUID = '00000000-0000-4000-8000-000000000001';
export const concretePath = (path: string, ids: Record<string, string> = {}) =>
  path.replace(/:([A-Za-z]+)/g, (_m, name: string) => ids[name] ?? FIXED_UUID);

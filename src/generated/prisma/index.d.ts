
/**
 * Client
**/

import * as runtime from './runtime/client.js';
import $Types = runtime.Types // general types
import $Public = runtime.Types.Public
import $Utils = runtime.Types.Utils
import $Extensions = runtime.Types.Extensions
import $Result = runtime.Types.Result

export type PrismaPromise<T> = $Public.PrismaPromise<T>


/**
 * Model ConnectedAccount
 * Compte externe (Gmail, puis Outlook) qu'un utilisateur Board LGEF a connecté
 * volontairement pour importer ses mails / agenda / drive dans l'app.
 * Connexion facultative : l'app fonctionne sans, avec les seules données
 * internes Supabase — voir Calendrier, Mails.
 * 
 * user_id référence auth.users(id) par convention (pas de FK Prisma : "auth"
 * n'est jamais inclus dans datasource.schemas, pour qu'un `db push` depuis ce
 * repo ne puisse jamais toucher au schéma d'authentification partagé — voir
 * le même choix dans ir2f/accred).
 */
export type ConnectedAccount = $Result.DefaultSelection<Prisma.$ConnectedAccountPayload>

/**
 * ##  Prisma Client ʲˢ
 *
 * Type-safe database client for TypeScript & Node.js
 * @example
 * ```
 * const prisma = new PrismaClient({
 *   adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL })
 * })
 * // Fetch zero or more ConnectedAccounts
 * const connectedAccounts = await prisma.connectedAccount.findMany()
 * ```
 *
 *
 * Read more in our [docs](https://pris.ly/d/client).
 */
export class PrismaClient<
  ClientOptions extends Prisma.PrismaClientOptions = Prisma.PrismaClientOptions,
  const U = 'log' extends keyof ClientOptions ? ClientOptions['log'] extends Array<Prisma.LogLevel | Prisma.LogDefinition> ? Prisma.GetEvents<ClientOptions['log']> : never : never,
  ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs
> {
  [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['other'] }

    /**
   * ##  Prisma Client ʲˢ
   *
   * Type-safe database client for TypeScript & Node.js
   * @example
   * ```
   * const prisma = new PrismaClient({
   *   adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL })
   * })
   * // Fetch zero or more ConnectedAccounts
   * const connectedAccounts = await prisma.connectedAccount.findMany()
   * ```
   *
   *
   * Read more in our [docs](https://pris.ly/d/client).
   */

  constructor(optionsArg ?: Prisma.PrismaClientConstructorArgs<ClientOptions>);
  $on<V extends U>(eventType: V, callback: (event: V extends 'query' ? Prisma.QueryEvent : Prisma.LogEvent) => void): PrismaClient;

  /**
   * Connect with the database
   */
  $connect(): $Utils.JsPromise<void>;

  /**
   * Disconnect from the database
   */
  $disconnect(): $Utils.JsPromise<void>;

/**
   * Executes a prepared raw query and returns the number of affected rows.
   * @example
   * ```
   * const result = await prisma.$executeRaw`UPDATE User SET cool = ${true} WHERE email = ${'user@email.com'};`
   * ```
   *
   * Read more in our [docs](https://pris.ly/d/raw-queries).
   */
  $executeRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Executes a raw query and returns the number of affected rows.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$executeRawUnsafe('UPDATE User SET cool = $1 WHERE email = $2 ;', true, 'user@email.com')
   * ```
   *
   * Read more in our [docs](https://pris.ly/d/raw-queries).
   */
  $executeRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Performs a prepared raw query and returns the `SELECT` data.
   * @example
   * ```
   * const result = await prisma.$queryRaw`SELECT * FROM User WHERE id = ${1} OR email = ${'user@email.com'};`
   * ```
   *
   * Read more in our [docs](https://pris.ly/d/raw-queries).
   */
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<T>;

  /**
   * Performs a raw query and returns the `SELECT` data.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$queryRawUnsafe('SELECT * FROM User WHERE id = $1 OR email = $2;', 1, 'user@email.com')
   * ```
   *
   * Read more in our [docs](https://pris.ly/d/raw-queries).
   */
  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<T>;


  /**
   * Allows the running of a sequence of read/write operations that are guaranteed to either succeed or fail as a whole.
   * @example
   * ```
   * const [george, bob, alice] = await prisma.$transaction([
   *   prisma.user.create({ data: { name: 'George' } }),
   *   prisma.user.create({ data: { name: 'Bob' } }),
   *   prisma.user.create({ data: { name: 'Alice' } }),
   * ])
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/orm/prisma-client/queries/transactions).
   */
  $transaction<P extends Prisma.PrismaPromise<any>[]>(arg: [...P], options?: { maxWait?: number, timeout?: number, isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<runtime.Types.Utils.UnwrapTuple<P>>

  $transaction<R>(fn: (prisma: Omit<PrismaClient, runtime.ITXClientDenyList>) => $Utils.JsPromise<R>, options?: { maxWait?: number, timeout?: number, isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<R>

  $extends: $Extensions.ExtendsHook<"extends", Prisma.TypeMapCb<ClientOptions>, ExtArgs, $Utils.Call<Prisma.TypeMapCb<ClientOptions>, {
    extArgs: ExtArgs
  }>>

      /**
   * `prisma.connectedAccount`: Exposes CRUD operations for the **ConnectedAccount** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more ConnectedAccounts
    * const connectedAccounts = await prisma.connectedAccount.findMany()
    * ```
    */
  get connectedAccount(): Prisma.ConnectedAccountDelegate<ExtArgs, ClientOptions>;
}

export namespace Prisma {
  export import DMMF = runtime.DMMF

  export type PrismaPromise<T> = $Public.PrismaPromise<T>

  /**
   * Validator
   */
  export import validator = runtime.Public.validator

  /**
   * Prisma Errors
   */
  export import PrismaClientKnownRequestError = runtime.PrismaClientKnownRequestError
  export import PrismaClientUnknownRequestError = runtime.PrismaClientUnknownRequestError
  export import PrismaClientRustPanicError = runtime.PrismaClientRustPanicError
  export import PrismaClientInitializationError = runtime.PrismaClientInitializationError
  export import PrismaClientValidationError = runtime.PrismaClientValidationError

  /**
   * Re-export of sql-template-tag
   */
  export import sql = runtime.sqltag
  export import empty = runtime.empty
  export import join = runtime.join
  export import raw = runtime.raw
  export import Sql = runtime.Sql



  /**
   * Decimal.js
   */
  export import Decimal = runtime.Decimal

  export type DecimalJsLike = runtime.DecimalJsLike

  /**
  * Extensions
  */
  export import Extension = $Extensions.UserArgs
  export import getExtensionContext = runtime.Extensions.getExtensionContext
  export import Args = $Public.Args
  export import Payload = $Public.Payload
  export import Result = $Public.Result
  export import Exact = $Public.Exact

  /**
   * Prisma Client JS version: 7.10.0
   * Query Engine version: 0edf323efd1d98336f3f0a68684b56f689b900d3
   */
  export type PrismaVersion = {
    client: string
    engine: string
  }

  export const prismaVersion: PrismaVersion

  /**
   * Utility Types
   */


  export import Bytes = runtime.Bytes
  export import JsonObject = runtime.JsonObject
  export import JsonArray = runtime.JsonArray
  export import JsonValue = runtime.JsonValue
  export import InputJsonObject = runtime.InputJsonObject
  export import InputJsonArray = runtime.InputJsonArray
  export import InputJsonValue = runtime.InputJsonValue

  /**
   * Types of the values used to represent different kinds of `null` values when working with JSON fields.
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  namespace NullTypes {
    /**
    * Type of `Prisma.DbNull`.
    *
    * You cannot use other instances of this class. Please use the `Prisma.DbNull` value.
    *
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class DbNull {
      private DbNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.JsonNull`.
    *
    * You cannot use other instances of this class. Please use the `Prisma.JsonNull` value.
    *
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class JsonNull {
      private JsonNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.AnyNull`.
    *
    * You cannot use other instances of this class. Please use the `Prisma.AnyNull` value.
    *
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class AnyNull {
      private AnyNull: never
      private constructor()
    }
  }

  /**
   * Helper for filtering JSON entries that have `null` on the database (empty on the db)
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const DbNull: NullTypes.DbNull

  /**
   * Helper for filtering JSON entries that have JSON `null` values (not empty on the db)
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const JsonNull: NullTypes.JsonNull

  /**
   * Helper for filtering JSON entries that are `Prisma.DbNull` or `Prisma.JsonNull`
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const AnyNull: NullTypes.AnyNull

  type SelectAndInclude = {
    select: any
    include: any
  }

  type SelectAndOmit = {
    select: any
    omit: any
  }

  /**
   * Get the type of the value, that the Promise holds.
   */
  export type PromiseType<T extends PromiseLike<any>> = T extends PromiseLike<infer U> ? U : T;

  /**
   * Get the return type of a function which returns a Promise.
   */
  export type PromiseReturnType<T extends (...args: any) => $Utils.JsPromise<any>> = PromiseType<ReturnType<T>>

  /**
   * From T, pick a set of properties whose keys are in the union K
   */
  type Prisma__Pick<T, K extends keyof T> = {
      [P in K]: T[P];
  };


  export type Enumerable<T> = T | Array<T>;

  export type RequiredKeys<T> = {
    [K in keyof T]-?: {} extends Prisma__Pick<T, K> ? never : K
  }[keyof T]

  export type TruthyKeys<T> = keyof {
    [K in keyof T as T[K] extends false | undefined | null ? never : K]: K
  }

  export type TrueKeys<T> = TruthyKeys<Prisma__Pick<T, RequiredKeys<T>>>

  /**
   * Subset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection
   */
  export type Subset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never;
  };

  /**
   * Resolved type of the argument passed to the `PrismaClient` constructor.
   *
   * When called without a narrower options type (the common case), this resolves
   * to `PrismaClientOptions` directly, which produces a clear TypeScript error
   * message (`not assignable to parameter of type 'PrismaClientOptions'`) when
   * the argument is missing or incomplete. When the user supplies a narrower
   * options type (e.g. via a literal), it falls back to `Subset` to keep
   * filtering out unknown properties.
   */
  export type PrismaClientConstructorArgs<Options extends PrismaClientOptions> =
    [PrismaClientOptions] extends [Options] ? PrismaClientOptions : Subset<Options, PrismaClientOptions>;

  /**
   * SelectSubset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection.
   * Additionally, it validates, if both select and include are present. If the case, it errors.
   */
  export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    (T extends SelectAndInclude
      ? 'Please either choose `select` or `include`.'
      : T extends SelectAndOmit
        ? 'Please either choose `select` or `omit`.'
        : {})

  /**
   * Subset + Intersection
   * @desc From `T` pick properties that exist in `U` and intersect `K`
   */
  export type SubsetIntersection<T, U, K> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    K

  type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };

  /**
   * XOR is needed to have a real mutually exclusive union type
   * https://stackoverflow.com/questions/42123407/does-typescript-support-mutually-exclusive-types
   */
  type XOR<T, U> =
    T extends object ?
    U extends object ?
      ((Without<T, U> & U) | (Without<U, T> & T)) & object
    : U : T


  /**
   * Is T a Record?
   */
  type IsObject<T extends any> = T extends Array<any>
  ? False
  : T extends Date
  ? False
  : T extends Uint8Array
  ? False
  : T extends BigInt
  ? False
  : T extends object
  ? True
  : False


  /**
   * If it's T[], return T
   */
  export type UnEnumerate<T extends unknown> = T extends Array<infer U> ? U : T

  /**
   * From ts-toolbelt
   */

  type __Either<O extends object, K extends Key> = Omit<O, K> &
    {
      // Merge all but K
      [P in K]: Prisma__Pick<O, P & keyof O> // With K possibilities
    }[K]

  type EitherStrict<O extends object, K extends Key> = Strict<__Either<O, K>>

  type EitherLoose<O extends object, K extends Key> = ComputeRaw<__Either<O, K>>

  type _Either<
    O extends object,
    K extends Key,
    strict extends Boolean
  > = {
    1: EitherStrict<O, K>
    0: EitherLoose<O, K>
  }[strict]

  type Either<
    O extends object,
    K extends Key,
    strict extends Boolean = 1
  > = O extends unknown ? _Either<O, K, strict> : never

  export type Union = any

  type PatchUndefined<O extends object, O1 extends object> = {
    [K in keyof O]: O[K] extends undefined ? At<O1, K> : O[K]
  } & {}

  /** Helper Types for "Merge" **/
  export type IntersectOf<U extends Union> = (
    U extends unknown ? (k: U) => void : never
  ) extends (k: infer I) => void
    ? I
    : never

  export type Overwrite<O extends object, O1 extends object> = {
      [K in keyof O]: K extends keyof O1 ? O1[K] : O[K];
  } & {};

  type _Merge<U extends object> = IntersectOf<Overwrite<U, {
      [K in keyof U]-?: At<U, K>;
  }>>;

  type Key = string | number | symbol;
  type AtBasic<O extends object, K extends Key> = K extends keyof O ? O[K] : never;
  type AtStrict<O extends object, K extends Key> = O[K & keyof O];
  type AtLoose<O extends object, K extends Key> = O extends unknown ? AtStrict<O, K> : never;
  export type At<O extends object, K extends Key, strict extends Boolean = 1> = {
      1: AtStrict<O, K>;
      0: AtLoose<O, K>;
  }[strict];

  export type ComputeRaw<A extends any> = A extends Function ? A : {
    [K in keyof A]: A[K];
  } & {};

  export type OptionalFlat<O> = {
    [K in keyof O]?: O[K];
  } & {};

  type _Record<K extends keyof any, T> = {
    [P in K]: T;
  };

  // cause typescript not to expand types and preserve names
  type NoExpand<T> = T extends unknown ? T : never;

  // this type assumes the passed object is entirely optional
  type AtLeast<O extends object, K extends string> = NoExpand<
    O extends unknown
    ? | (K extends keyof O ? { [P in K]: O[P] } & O : O)
      | {[P in keyof O as P extends K ? P : never]-?: O[P]} & O
    : never>;

  type _Strict<U, _U = U> = U extends unknown ? U & OptionalFlat<_Record<Exclude<Keys<_U>, keyof U>, never>> : never;

  export type Strict<U extends object> = ComputeRaw<_Strict<U>>;
  /** End Helper Types for "Merge" **/

  export type Merge<U extends object> = ComputeRaw<_Merge<Strict<U>>>;

  /**
  A [[Boolean]]
  */
  export type Boolean = True | False

  // /**
  // 1
  // */
  export type True = 1

  /**
  0
  */
  export type False = 0

  export type Not<B extends Boolean> = {
    0: 1
    1: 0
  }[B]

  export type Extends<A1 extends any, A2 extends any> = [A1] extends [never]
    ? 0 // anything `never` is false
    : A1 extends A2
    ? 1
    : 0

  export type Has<U extends Union, U1 extends Union> = Not<
    Extends<Exclude<U1, U>, U1>
  >

  export type Or<B1 extends Boolean, B2 extends Boolean> = {
    0: {
      0: 0
      1: 1
    }
    1: {
      0: 1
      1: 1
    }
  }[B1][B2]

  export type Keys<U extends Union> = U extends unknown ? keyof U : never

  type Cast<A, B> = A extends B ? A : B;

  export const type: unique symbol;



  /**
   * Used by group by
   */

  export type GetScalarType<T, O> = O extends object ? {
    [P in keyof T]: P extends keyof O
      ? O[P]
      : never
  } : never

  type FieldPaths<
    T,
    U = Omit<T, '_avg' | '_sum' | '_count' | '_min' | '_max'>
  > = IsObject<T> extends True ? U : T

  type GetHavingFields<T> = {
    [K in keyof T]: Or<
      Or<Extends<'OR', K>, Extends<'AND', K>>,
      Extends<'NOT', K>
    > extends True
      ? // infer is only needed to not hit TS limit
        // based on the brilliant idea of Pierre-Antoine Mills
        // https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437
        T[K] extends infer TK
        ? GetHavingFields<UnEnumerate<TK> extends object ? Merge<UnEnumerate<TK>> : never>
        : never
      : {} extends FieldPaths<T[K]>
      ? never
      : K
  }[keyof T]

  /**
   * Convert tuple to union
   */
  type _TupleToUnion<T> = T extends (infer E)[] ? E : never
  type TupleToUnion<K extends readonly any[]> = _TupleToUnion<K>
  type MaybeTupleToUnion<T> = T extends any[] ? TupleToUnion<T> : T

  /**
   * Like `Pick`, but additionally can also accept an array of keys
   */
  type PickEnumerable<T, K extends Enumerable<keyof T> | keyof T> = Prisma__Pick<T, MaybeTupleToUnion<K>>

  /**
   * Exclude all keys with underscores
   */
  type ExcludeUnderscoreKeys<T extends string> = T extends `_${string}` ? never : T


  export type FieldRef<Model, FieldType> = runtime.FieldRef<Model, FieldType>

  type FieldRefInputType<Model, FieldType> = Model extends never ? never : FieldRef<Model, FieldType>


  export const ModelName: {
    ConnectedAccount: 'ConnectedAccount'
  };

  export type ModelName = (typeof ModelName)[keyof typeof ModelName]



  interface TypeMapCb<ClientOptions = {}> extends $Utils.Fn<{extArgs: $Extensions.InternalArgs }, $Utils.Record<string, any>> {
    returns: Prisma.TypeMap<this['params']['extArgs'], ClientOptions extends { omit: infer OmitOptions } ? OmitOptions : {}>
  }

  export type TypeMap<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> = {
    globalOmitOptions: {
      omit: GlobalOmitOptions
    }
    meta: {
      modelProps: "connectedAccount"
      txIsolationLevel: Prisma.TransactionIsolationLevel
    }
    model: {
      ConnectedAccount: {
        payload: Prisma.$ConnectedAccountPayload<ExtArgs>
        fields: Prisma.ConnectedAccountFieldRefs
        operations: {
          findUnique: {
            args: Prisma.ConnectedAccountFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConnectedAccountPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.ConnectedAccountFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConnectedAccountPayload>
          }
          findFirst: {
            args: Prisma.ConnectedAccountFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConnectedAccountPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.ConnectedAccountFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConnectedAccountPayload>
          }
          findMany: {
            args: Prisma.ConnectedAccountFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConnectedAccountPayload>[]
          }
          create: {
            args: Prisma.ConnectedAccountCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConnectedAccountPayload>
          }
          createMany: {
            args: Prisma.ConnectedAccountCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.ConnectedAccountCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConnectedAccountPayload>[]
          }
          delete: {
            args: Prisma.ConnectedAccountDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConnectedAccountPayload>
          }
          update: {
            args: Prisma.ConnectedAccountUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConnectedAccountPayload>
          }
          deleteMany: {
            args: Prisma.ConnectedAccountDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.ConnectedAccountUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateManyAndReturn: {
            args: Prisma.ConnectedAccountUpdateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConnectedAccountPayload>[]
          }
          upsert: {
            args: Prisma.ConnectedAccountUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$ConnectedAccountPayload>
          }
          aggregate: {
            args: Prisma.ConnectedAccountAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateConnectedAccount>
          }
          groupBy: {
            args: Prisma.ConnectedAccountGroupByArgs<ExtArgs>
            result: $Utils.Optional<ConnectedAccountGroupByOutputType>[]
          }
          count: {
            args: Prisma.ConnectedAccountCountArgs<ExtArgs>
            result: $Utils.Optional<ConnectedAccountCountAggregateOutputType> | number
          }
        }
      }
    }
  } & {
    other: {
      payload: any
      operations: {
        $executeRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $executeRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
        $queryRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $queryRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
      }
    }
  }
  export const defineExtension: $Extensions.ExtendsHook<"define", Prisma.TypeMapCb, $Extensions.DefaultArgs>
  export type DefaultPrismaClient = PrismaClient
  export type ErrorFormat = 'pretty' | 'colorless' | 'minimal'
  export interface PrismaClientOptions {
    /**
     * @default "colorless"
     */
    errorFormat?: ErrorFormat
    /**
     * @example
     * ```
     * // Shorthand for `emit: 'stdout'`
     * log: ['query', 'info', 'warn', 'error']
     * 
     * // Emit as events only
     * log: [
     *   { emit: 'event', level: 'query' },
     *   { emit: 'event', level: 'info' },
     *   { emit: 'event', level: 'warn' }
     *   { emit: 'event', level: 'error' }
     * ]
     * 
     * / Emit as events and log to stdout
     * og: [
     *  { emit: 'stdout', level: 'query' },
     *  { emit: 'stdout', level: 'info' },
     *  { emit: 'stdout', level: 'warn' }
     *  { emit: 'stdout', level: 'error' }
     * 
     * ```
     * Read more in our [docs](https://pris.ly/d/logging).
     */
    log?: (LogLevel | LogDefinition)[]
    /**
     * The default values for transactionOptions
     * maxWait ?= 2000
     * timeout ?= 5000
     */
    transactionOptions?: {
      maxWait?: number
      timeout?: number
      isolationLevel?: Prisma.TransactionIsolationLevel
    }
    /**
     * A driver adapter that PrismaClient uses to connect to your database, such as the ones provided by `@prisma/adapter-pg`, `@prisma/adapter-libsql`, `@prisma/adapter-planetscale`, etc.
     * 
     * A driver adapter is **required** unless you connect to your database through Prisma Accelerate (in which case use `accelerateUrl` instead).
     * 
     * Learn more: https://pris.ly/d/driver-adapters
     * 
     * @example
     * ```ts
     * import { PrismaPg } from '@prisma/adapter-pg'
     * import { PrismaClient } from './generated/prisma/client'
     * 
     * const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
     * const prisma = new PrismaClient({ adapter })
     * ```
     */
    adapter?: runtime.SqlDriverAdapterFactory
    /**
     * The Prisma Accelerate connection URL. Use this option to connect to your database through Prisma Accelerate instead of using a driver adapter to connect directly.
     * 
     * Learn more: https://pris.ly/d/accelerate
     */
    accelerateUrl?: string
    /**
     * Global configuration for omitting model fields by default.
     * 
     * @example
     * ```
     * const prisma = new PrismaClient({
     *   omit: {
     *     user: {
     *       password: true
     *     }
     *   }
     * })
     * ```
     */
    omit?: Prisma.GlobalOmitConfig
    /**
     * SQL commenter plugins that add metadata to SQL queries as comments.
     * Comments follow the sqlcommenter format: https://google.github.io/sqlcommenter/
     * 
     * @example
     * ```
     * const prisma = new PrismaClient({
     *   adapter,
     *   comments: [
     *     traceContext(),
     *     queryInsights(),
     *   ],
     * })
     * ```
     */
    comments?: runtime.SqlCommenterPlugin[]
  }
  export type GlobalOmitConfig = {
    connectedAccount?: ConnectedAccountOmit
  }

  /* Types for Logging */
  export type LogLevel = 'info' | 'query' | 'warn' | 'error'
  export type LogDefinition = {
    level: LogLevel
    emit: 'stdout' | 'event'
  }

  export type CheckIsLogLevel<T> = T extends LogLevel ? T : never;

  export type GetLogType<T> = CheckIsLogLevel<
    T extends LogDefinition ? T['level'] : T
  >;

  export type GetEvents<T extends any[]> = T extends Array<LogLevel | LogDefinition>
    ? GetLogType<T[number]>
    : never;

  export type QueryEvent = {
    timestamp: Date
    query: string
    params: string
    duration: number
    target: string
  }

  export type LogEvent = {
    timestamp: Date
    message: string
    target: string
  }
  /* End Types for Logging */


  export type PrismaAction =
    | 'findUnique'
    | 'findUniqueOrThrow'
    | 'findMany'
    | 'findFirst'
    | 'findFirstOrThrow'
    | 'create'
    | 'createMany'
    | 'createManyAndReturn'
    | 'update'
    | 'updateMany'
    | 'updateManyAndReturn'
    | 'upsert'
    | 'delete'
    | 'deleteMany'
    | 'executeRaw'
    | 'queryRaw'
    | 'aggregate'
    | 'count'
    | 'runCommandRaw'
    | 'findRaw'
    | 'groupBy'

  // tested in getLogLevel.test.ts
  export function getLogLevel(log: Array<LogLevel | LogDefinition>): LogLevel | undefined;

  /**
   * `PrismaClient` proxy available in interactive transactions.
   */
  export type TransactionClient = Omit<Prisma.DefaultPrismaClient, runtime.ITXClientDenyList>

  export type Datasource = {
    url?: string
  }

  /**
   * Count Types
   */



  /**
   * Models
   */

  /**
   * Model ConnectedAccount
   */

  export type AggregateConnectedAccount = {
    _count: ConnectedAccountCountAggregateOutputType | null
    _min: ConnectedAccountMinAggregateOutputType | null
    _max: ConnectedAccountMaxAggregateOutputType | null
  }

  export type ConnectedAccountMinAggregateOutputType = {
    id: string | null
    user_id: string | null
    provider: string | null
    provider_account_id: string | null
    email: string | null
    label: string | null
    access_token: string | null
    refresh_token: string | null
    token_expires_at: Date | null
    created_at: Date | null
    updated_at: Date | null
  }

  export type ConnectedAccountMaxAggregateOutputType = {
    id: string | null
    user_id: string | null
    provider: string | null
    provider_account_id: string | null
    email: string | null
    label: string | null
    access_token: string | null
    refresh_token: string | null
    token_expires_at: Date | null
    created_at: Date | null
    updated_at: Date | null
  }

  export type ConnectedAccountCountAggregateOutputType = {
    id: number
    user_id: number
    provider: number
    provider_account_id: number
    email: number
    label: number
    access_token: number
    refresh_token: number
    token_expires_at: number
    scopes: number
    created_at: number
    updated_at: number
    _all: number
  }


  export type ConnectedAccountMinAggregateInputType = {
    id?: true
    user_id?: true
    provider?: true
    provider_account_id?: true
    email?: true
    label?: true
    access_token?: true
    refresh_token?: true
    token_expires_at?: true
    created_at?: true
    updated_at?: true
  }

  export type ConnectedAccountMaxAggregateInputType = {
    id?: true
    user_id?: true
    provider?: true
    provider_account_id?: true
    email?: true
    label?: true
    access_token?: true
    refresh_token?: true
    token_expires_at?: true
    created_at?: true
    updated_at?: true
  }

  export type ConnectedAccountCountAggregateInputType = {
    id?: true
    user_id?: true
    provider?: true
    provider_account_id?: true
    email?: true
    label?: true
    access_token?: true
    refresh_token?: true
    token_expires_at?: true
    scopes?: true
    created_at?: true
    updated_at?: true
    _all?: true
  }

  export type ConnectedAccountAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which ConnectedAccount to aggregate.
     */
    where?: ConnectedAccountWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ConnectedAccounts to fetch.
     */
    orderBy?: ConnectedAccountOrderByWithRelationInput | ConnectedAccountOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: ConnectedAccountWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ConnectedAccounts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ConnectedAccounts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned ConnectedAccounts
    **/
    _count?: true | ConnectedAccountCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: ConnectedAccountMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: ConnectedAccountMaxAggregateInputType
  }

  export type GetConnectedAccountAggregateType<T extends ConnectedAccountAggregateArgs> = {
        [P in keyof T & keyof AggregateConnectedAccount]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateConnectedAccount[P]>
      : GetScalarType<T[P], AggregateConnectedAccount[P]>
  }




  export type ConnectedAccountGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ConnectedAccountWhereInput
    orderBy?: ConnectedAccountOrderByWithAggregationInput | ConnectedAccountOrderByWithAggregationInput[]
    by: ConnectedAccountScalarFieldEnum[] | ConnectedAccountScalarFieldEnum
    having?: ConnectedAccountScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: ConnectedAccountCountAggregateInputType | true
    _min?: ConnectedAccountMinAggregateInputType
    _max?: ConnectedAccountMaxAggregateInputType
  }

  export type ConnectedAccountGroupByOutputType = {
    id: string
    user_id: string
    provider: string
    provider_account_id: string
    email: string
    label: string | null
    access_token: string
    refresh_token: string
    token_expires_at: Date
    scopes: string[]
    created_at: Date
    updated_at: Date
    _count: ConnectedAccountCountAggregateOutputType | null
    _min: ConnectedAccountMinAggregateOutputType | null
    _max: ConnectedAccountMaxAggregateOutputType | null
  }

  type GetConnectedAccountGroupByPayload<T extends ConnectedAccountGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<ConnectedAccountGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof ConnectedAccountGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], ConnectedAccountGroupByOutputType[P]>
            : GetScalarType<T[P], ConnectedAccountGroupByOutputType[P]>
        }
      >
    >


  export type ConnectedAccountSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    user_id?: boolean
    provider?: boolean
    provider_account_id?: boolean
    email?: boolean
    label?: boolean
    access_token?: boolean
    refresh_token?: boolean
    token_expires_at?: boolean
    scopes?: boolean
    created_at?: boolean
    updated_at?: boolean
  }, ExtArgs["result"]["connectedAccount"]>

  export type ConnectedAccountSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    user_id?: boolean
    provider?: boolean
    provider_account_id?: boolean
    email?: boolean
    label?: boolean
    access_token?: boolean
    refresh_token?: boolean
    token_expires_at?: boolean
    scopes?: boolean
    created_at?: boolean
    updated_at?: boolean
  }, ExtArgs["result"]["connectedAccount"]>

  export type ConnectedAccountSelectUpdateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    user_id?: boolean
    provider?: boolean
    provider_account_id?: boolean
    email?: boolean
    label?: boolean
    access_token?: boolean
    refresh_token?: boolean
    token_expires_at?: boolean
    scopes?: boolean
    created_at?: boolean
    updated_at?: boolean
  }, ExtArgs["result"]["connectedAccount"]>

  export type ConnectedAccountSelectScalar = {
    id?: boolean
    user_id?: boolean
    provider?: boolean
    provider_account_id?: boolean
    email?: boolean
    label?: boolean
    access_token?: boolean
    refresh_token?: boolean
    token_expires_at?: boolean
    scopes?: boolean
    created_at?: boolean
    updated_at?: boolean
  }

  export type ConnectedAccountOmit<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetOmit<"id" | "user_id" | "provider" | "provider_account_id" | "email" | "label" | "access_token" | "refresh_token" | "token_expires_at" | "scopes" | "created_at" | "updated_at", ExtArgs["result"]["connectedAccount"]>

  export type $ConnectedAccountPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "ConnectedAccount"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      user_id: string
      provider: string
      provider_account_id: string
      email: string
      label: string | null
      access_token: string
      refresh_token: string
      token_expires_at: Date
      scopes: string[]
      created_at: Date
      updated_at: Date
    }, ExtArgs["result"]["connectedAccount"]>
    composites: {}
  }

  type ConnectedAccountGetPayload<S extends boolean | null | undefined | ConnectedAccountDefaultArgs> = $Result.GetResult<Prisma.$ConnectedAccountPayload, S>

  type ConnectedAccountCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> =
    Omit<ConnectedAccountFindManyArgs, 'select' | 'include' | 'distinct' | 'omit'> & {
      select?: ConnectedAccountCountAggregateInputType | true
    }

  export interface ConnectedAccountDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['ConnectedAccount'], meta: { name: 'ConnectedAccount' } }
    /**
     * Find zero or one ConnectedAccount that matches the filter.
     * @param {ConnectedAccountFindUniqueArgs} args - Arguments to find a ConnectedAccount
     * @example
     * // Get one ConnectedAccount
     * const connectedAccount = await prisma.connectedAccount.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends ConnectedAccountFindUniqueArgs>(args: SelectSubset<T, ConnectedAccountFindUniqueArgs<ExtArgs>>): Prisma__ConnectedAccountClient<$Result.GetResult<Prisma.$ConnectedAccountPayload<ExtArgs>, T, "findUnique", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find one ConnectedAccount that matches the filter or throw an error with `error.code='P2025'`
     * if no matches were found.
     * @param {ConnectedAccountFindUniqueOrThrowArgs} args - Arguments to find a ConnectedAccount
     * @example
     * // Get one ConnectedAccount
     * const connectedAccount = await prisma.connectedAccount.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends ConnectedAccountFindUniqueOrThrowArgs>(args: SelectSubset<T, ConnectedAccountFindUniqueOrThrowArgs<ExtArgs>>): Prisma__ConnectedAccountClient<$Result.GetResult<Prisma.$ConnectedAccountPayload<ExtArgs>, T, "findUniqueOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first ConnectedAccount that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ConnectedAccountFindFirstArgs} args - Arguments to find a ConnectedAccount
     * @example
     * // Get one ConnectedAccount
     * const connectedAccount = await prisma.connectedAccount.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends ConnectedAccountFindFirstArgs>(args?: SelectSubset<T, ConnectedAccountFindFirstArgs<ExtArgs>>): Prisma__ConnectedAccountClient<$Result.GetResult<Prisma.$ConnectedAccountPayload<ExtArgs>, T, "findFirst", GlobalOmitOptions> | null, null, ExtArgs, GlobalOmitOptions>

    /**
     * Find the first ConnectedAccount that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ConnectedAccountFindFirstOrThrowArgs} args - Arguments to find a ConnectedAccount
     * @example
     * // Get one ConnectedAccount
     * const connectedAccount = await prisma.connectedAccount.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends ConnectedAccountFindFirstOrThrowArgs>(args?: SelectSubset<T, ConnectedAccountFindFirstOrThrowArgs<ExtArgs>>): Prisma__ConnectedAccountClient<$Result.GetResult<Prisma.$ConnectedAccountPayload<ExtArgs>, T, "findFirstOrThrow", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Find zero or more ConnectedAccounts that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ConnectedAccountFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all ConnectedAccounts
     * const connectedAccounts = await prisma.connectedAccount.findMany()
     * 
     * // Get first 10 ConnectedAccounts
     * const connectedAccounts = await prisma.connectedAccount.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const connectedAccountWithIdOnly = await prisma.connectedAccount.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends ConnectedAccountFindManyArgs>(args?: SelectSubset<T, ConnectedAccountFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ConnectedAccountPayload<ExtArgs>, T, "findMany", GlobalOmitOptions>>

    /**
     * Create a ConnectedAccount.
     * @param {ConnectedAccountCreateArgs} args - Arguments to create a ConnectedAccount.
     * @example
     * // Create one ConnectedAccount
     * const ConnectedAccount = await prisma.connectedAccount.create({
     *   data: {
     *     // ... data to create a ConnectedAccount
     *   }
     * })
     * 
     */
    create<T extends ConnectedAccountCreateArgs>(args: SelectSubset<T, ConnectedAccountCreateArgs<ExtArgs>>): Prisma__ConnectedAccountClient<$Result.GetResult<Prisma.$ConnectedAccountPayload<ExtArgs>, T, "create", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Create many ConnectedAccounts.
     * @param {ConnectedAccountCreateManyArgs} args - Arguments to create many ConnectedAccounts.
     * @example
     * // Create many ConnectedAccounts
     * const connectedAccount = await prisma.connectedAccount.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends ConnectedAccountCreateManyArgs>(args?: SelectSubset<T, ConnectedAccountCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many ConnectedAccounts and returns the data saved in the database.
     * @param {ConnectedAccountCreateManyAndReturnArgs} args - Arguments to create many ConnectedAccounts.
     * @example
     * // Create many ConnectedAccounts
     * const connectedAccount = await prisma.connectedAccount.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many ConnectedAccounts and only return the `id`
     * const connectedAccountWithIdOnly = await prisma.connectedAccount.createManyAndReturn({
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends ConnectedAccountCreateManyAndReturnArgs>(args?: SelectSubset<T, ConnectedAccountCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ConnectedAccountPayload<ExtArgs>, T, "createManyAndReturn", GlobalOmitOptions>>

    /**
     * Delete a ConnectedAccount.
     * @param {ConnectedAccountDeleteArgs} args - Arguments to delete one ConnectedAccount.
     * @example
     * // Delete one ConnectedAccount
     * const ConnectedAccount = await prisma.connectedAccount.delete({
     *   where: {
     *     // ... filter to delete one ConnectedAccount
     *   }
     * })
     * 
     */
    delete<T extends ConnectedAccountDeleteArgs>(args: SelectSubset<T, ConnectedAccountDeleteArgs<ExtArgs>>): Prisma__ConnectedAccountClient<$Result.GetResult<Prisma.$ConnectedAccountPayload<ExtArgs>, T, "delete", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Update one ConnectedAccount.
     * @param {ConnectedAccountUpdateArgs} args - Arguments to update one ConnectedAccount.
     * @example
     * // Update one ConnectedAccount
     * const connectedAccount = await prisma.connectedAccount.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends ConnectedAccountUpdateArgs>(args: SelectSubset<T, ConnectedAccountUpdateArgs<ExtArgs>>): Prisma__ConnectedAccountClient<$Result.GetResult<Prisma.$ConnectedAccountPayload<ExtArgs>, T, "update", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>

    /**
     * Delete zero or more ConnectedAccounts.
     * @param {ConnectedAccountDeleteManyArgs} args - Arguments to filter ConnectedAccounts to delete.
     * @example
     * // Delete a few ConnectedAccounts
     * const { count } = await prisma.connectedAccount.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends ConnectedAccountDeleteManyArgs>(args?: SelectSubset<T, ConnectedAccountDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more ConnectedAccounts.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ConnectedAccountUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many ConnectedAccounts
     * const connectedAccount = await prisma.connectedAccount.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends ConnectedAccountUpdateManyArgs>(args: SelectSubset<T, ConnectedAccountUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more ConnectedAccounts and returns the data updated in the database.
     * @param {ConnectedAccountUpdateManyAndReturnArgs} args - Arguments to update many ConnectedAccounts.
     * @example
     * // Update many ConnectedAccounts
     * const connectedAccount = await prisma.connectedAccount.updateManyAndReturn({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Update zero or more ConnectedAccounts and only return the `id`
     * const connectedAccountWithIdOnly = await prisma.connectedAccount.updateManyAndReturn({
     *   select: { id: true },
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    updateManyAndReturn<T extends ConnectedAccountUpdateManyAndReturnArgs>(args: SelectSubset<T, ConnectedAccountUpdateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ConnectedAccountPayload<ExtArgs>, T, "updateManyAndReturn", GlobalOmitOptions>>

    /**
     * Create or update one ConnectedAccount.
     * @param {ConnectedAccountUpsertArgs} args - Arguments to update or create a ConnectedAccount.
     * @example
     * // Update or create a ConnectedAccount
     * const connectedAccount = await prisma.connectedAccount.upsert({
     *   create: {
     *     // ... data to create a ConnectedAccount
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the ConnectedAccount we want to update
     *   }
     * })
     */
    upsert<T extends ConnectedAccountUpsertArgs>(args: SelectSubset<T, ConnectedAccountUpsertArgs<ExtArgs>>): Prisma__ConnectedAccountClient<$Result.GetResult<Prisma.$ConnectedAccountPayload<ExtArgs>, T, "upsert", GlobalOmitOptions>, never, ExtArgs, GlobalOmitOptions>


    /**
     * Count the number of ConnectedAccounts.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ConnectedAccountCountArgs} args - Arguments to filter ConnectedAccounts to count.
     * @example
     * // Count the number of ConnectedAccounts
     * const count = await prisma.connectedAccount.count({
     *   where: {
     *     // ... the filter for the ConnectedAccounts we want to count
     *   }
     * })
    **/
    count<T extends ConnectedAccountCountArgs>(
      args?: Subset<T, ConnectedAccountCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], ConnectedAccountCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a ConnectedAccount.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ConnectedAccountAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends ConnectedAccountAggregateArgs>(args: Subset<T, ConnectedAccountAggregateArgs>): Prisma.PrismaPromise<GetConnectedAccountAggregateType<T>>

    /**
     * Group by ConnectedAccount.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ConnectedAccountGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends ConnectedAccountGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: ConnectedAccountGroupByArgs['orderBy'] }
        : { orderBy?: ConnectedAccountGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, ConnectedAccountGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetConnectedAccountGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the ConnectedAccount model
   */
  readonly fields: ConnectedAccountFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for ConnectedAccount.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__ConnectedAccountClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, GlobalOmitOptions = {}> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the ConnectedAccount model
   */
  interface ConnectedAccountFieldRefs {
    readonly id: FieldRef<"ConnectedAccount", 'String'>
    readonly user_id: FieldRef<"ConnectedAccount", 'String'>
    readonly provider: FieldRef<"ConnectedAccount", 'String'>
    readonly provider_account_id: FieldRef<"ConnectedAccount", 'String'>
    readonly email: FieldRef<"ConnectedAccount", 'String'>
    readonly label: FieldRef<"ConnectedAccount", 'String'>
    readonly access_token: FieldRef<"ConnectedAccount", 'String'>
    readonly refresh_token: FieldRef<"ConnectedAccount", 'String'>
    readonly token_expires_at: FieldRef<"ConnectedAccount", 'DateTime'>
    readonly scopes: FieldRef<"ConnectedAccount", 'String[]'>
    readonly created_at: FieldRef<"ConnectedAccount", 'DateTime'>
    readonly updated_at: FieldRef<"ConnectedAccount", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * ConnectedAccount findUnique
   */
  export type ConnectedAccountFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ConnectedAccount
     */
    select?: ConnectedAccountSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ConnectedAccount
     */
    omit?: ConnectedAccountOmit<ExtArgs> | null
    /**
     * Filter, which ConnectedAccount to fetch.
     */
    where: ConnectedAccountWhereUniqueInput
  }

  /**
   * ConnectedAccount findUniqueOrThrow
   */
  export type ConnectedAccountFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ConnectedAccount
     */
    select?: ConnectedAccountSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ConnectedAccount
     */
    omit?: ConnectedAccountOmit<ExtArgs> | null
    /**
     * Filter, which ConnectedAccount to fetch.
     */
    where: ConnectedAccountWhereUniqueInput
  }

  /**
   * ConnectedAccount findFirst
   */
  export type ConnectedAccountFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ConnectedAccount
     */
    select?: ConnectedAccountSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ConnectedAccount
     */
    omit?: ConnectedAccountOmit<ExtArgs> | null
    /**
     * Filter, which ConnectedAccount to fetch.
     */
    where?: ConnectedAccountWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ConnectedAccounts to fetch.
     */
    orderBy?: ConnectedAccountOrderByWithRelationInput | ConnectedAccountOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for ConnectedAccounts.
     */
    cursor?: ConnectedAccountWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ConnectedAccounts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ConnectedAccounts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of ConnectedAccounts.
     */
    distinct?: ConnectedAccountScalarFieldEnum | ConnectedAccountScalarFieldEnum[]
  }

  /**
   * ConnectedAccount findFirstOrThrow
   */
  export type ConnectedAccountFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ConnectedAccount
     */
    select?: ConnectedAccountSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ConnectedAccount
     */
    omit?: ConnectedAccountOmit<ExtArgs> | null
    /**
     * Filter, which ConnectedAccount to fetch.
     */
    where?: ConnectedAccountWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ConnectedAccounts to fetch.
     */
    orderBy?: ConnectedAccountOrderByWithRelationInput | ConnectedAccountOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for ConnectedAccounts.
     */
    cursor?: ConnectedAccountWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ConnectedAccounts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ConnectedAccounts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of ConnectedAccounts.
     */
    distinct?: ConnectedAccountScalarFieldEnum | ConnectedAccountScalarFieldEnum[]
  }

  /**
   * ConnectedAccount findMany
   */
  export type ConnectedAccountFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ConnectedAccount
     */
    select?: ConnectedAccountSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ConnectedAccount
     */
    omit?: ConnectedAccountOmit<ExtArgs> | null
    /**
     * Filter, which ConnectedAccounts to fetch.
     */
    where?: ConnectedAccountWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ConnectedAccounts to fetch.
     */
    orderBy?: ConnectedAccountOrderByWithRelationInput | ConnectedAccountOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing ConnectedAccounts.
     */
    cursor?: ConnectedAccountWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ConnectedAccounts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ConnectedAccounts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of ConnectedAccounts.
     */
    distinct?: ConnectedAccountScalarFieldEnum | ConnectedAccountScalarFieldEnum[]
  }

  /**
   * ConnectedAccount create
   */
  export type ConnectedAccountCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ConnectedAccount
     */
    select?: ConnectedAccountSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ConnectedAccount
     */
    omit?: ConnectedAccountOmit<ExtArgs> | null
    /**
     * The data needed to create a ConnectedAccount.
     */
    data: XOR<ConnectedAccountCreateInput, ConnectedAccountUncheckedCreateInput>
  }

  /**
   * ConnectedAccount createMany
   */
  export type ConnectedAccountCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many ConnectedAccounts.
     */
    data: ConnectedAccountCreateManyInput | ConnectedAccountCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * ConnectedAccount createManyAndReturn
   */
  export type ConnectedAccountCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ConnectedAccount
     */
    select?: ConnectedAccountSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the ConnectedAccount
     */
    omit?: ConnectedAccountOmit<ExtArgs> | null
    /**
     * The data used to create many ConnectedAccounts.
     */
    data: ConnectedAccountCreateManyInput | ConnectedAccountCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * ConnectedAccount update
   */
  export type ConnectedAccountUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ConnectedAccount
     */
    select?: ConnectedAccountSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ConnectedAccount
     */
    omit?: ConnectedAccountOmit<ExtArgs> | null
    /**
     * The data needed to update a ConnectedAccount.
     */
    data: XOR<ConnectedAccountUpdateInput, ConnectedAccountUncheckedUpdateInput>
    /**
     * Choose, which ConnectedAccount to update.
     */
    where: ConnectedAccountWhereUniqueInput
  }

  /**
   * ConnectedAccount updateMany
   */
  export type ConnectedAccountUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update ConnectedAccounts.
     */
    data: XOR<ConnectedAccountUpdateManyMutationInput, ConnectedAccountUncheckedUpdateManyInput>
    /**
     * Filter which ConnectedAccounts to update
     */
    where?: ConnectedAccountWhereInput
    /**
     * Limit how many ConnectedAccounts to update.
     */
    limit?: number
  }

  /**
   * ConnectedAccount updateManyAndReturn
   */
  export type ConnectedAccountUpdateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ConnectedAccount
     */
    select?: ConnectedAccountSelectUpdateManyAndReturn<ExtArgs> | null
    /**
     * Omit specific fields from the ConnectedAccount
     */
    omit?: ConnectedAccountOmit<ExtArgs> | null
    /**
     * The data used to update ConnectedAccounts.
     */
    data: XOR<ConnectedAccountUpdateManyMutationInput, ConnectedAccountUncheckedUpdateManyInput>
    /**
     * Filter which ConnectedAccounts to update
     */
    where?: ConnectedAccountWhereInput
    /**
     * Limit how many ConnectedAccounts to update.
     */
    limit?: number
  }

  /**
   * ConnectedAccount upsert
   */
  export type ConnectedAccountUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ConnectedAccount
     */
    select?: ConnectedAccountSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ConnectedAccount
     */
    omit?: ConnectedAccountOmit<ExtArgs> | null
    /**
     * The filter to search for the ConnectedAccount to update in case it exists.
     */
    where: ConnectedAccountWhereUniqueInput
    /**
     * In case the ConnectedAccount found by the `where` argument doesn't exist, create a new ConnectedAccount with this data.
     */
    create: XOR<ConnectedAccountCreateInput, ConnectedAccountUncheckedCreateInput>
    /**
     * In case the ConnectedAccount was found with the provided `where` argument, update it with this data.
     */
    update: XOR<ConnectedAccountUpdateInput, ConnectedAccountUncheckedUpdateInput>
  }

  /**
   * ConnectedAccount delete
   */
  export type ConnectedAccountDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ConnectedAccount
     */
    select?: ConnectedAccountSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ConnectedAccount
     */
    omit?: ConnectedAccountOmit<ExtArgs> | null
    /**
     * Filter which ConnectedAccount to delete.
     */
    where: ConnectedAccountWhereUniqueInput
  }

  /**
   * ConnectedAccount deleteMany
   */
  export type ConnectedAccountDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which ConnectedAccounts to delete
     */
    where?: ConnectedAccountWhereInput
    /**
     * Limit how many ConnectedAccounts to delete.
     */
    limit?: number
  }

  /**
   * ConnectedAccount without action
   */
  export type ConnectedAccountDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ConnectedAccount
     */
    select?: ConnectedAccountSelect<ExtArgs> | null
    /**
     * Omit specific fields from the ConnectedAccount
     */
    omit?: ConnectedAccountOmit<ExtArgs> | null
  }


  /**
   * Enums
   */

  export const TransactionIsolationLevel: {
    ReadUncommitted: 'ReadUncommitted',
    ReadCommitted: 'ReadCommitted',
    RepeatableRead: 'RepeatableRead',
    Serializable: 'Serializable'
  };

  export type TransactionIsolationLevel = (typeof TransactionIsolationLevel)[keyof typeof TransactionIsolationLevel]


  export const ConnectedAccountScalarFieldEnum: {
    id: 'id',
    user_id: 'user_id',
    provider: 'provider',
    provider_account_id: 'provider_account_id',
    email: 'email',
    label: 'label',
    access_token: 'access_token',
    refresh_token: 'refresh_token',
    token_expires_at: 'token_expires_at',
    scopes: 'scopes',
    created_at: 'created_at',
    updated_at: 'updated_at'
  };

  export type ConnectedAccountScalarFieldEnum = (typeof ConnectedAccountScalarFieldEnum)[keyof typeof ConnectedAccountScalarFieldEnum]


  export const SortOrder: {
    asc: 'asc',
    desc: 'desc'
  };

  export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder]


  export const QueryMode: {
    default: 'default',
    insensitive: 'insensitive'
  };

  export type QueryMode = (typeof QueryMode)[keyof typeof QueryMode]


  export const NullsOrder: {
    first: 'first',
    last: 'last'
  };

  export type NullsOrder = (typeof NullsOrder)[keyof typeof NullsOrder]


  /**
   * Field references
   */


  /**
   * Reference to a field of type 'String'
   */
  export type StringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String'>
    


  /**
   * Reference to a field of type 'String[]'
   */
  export type ListStringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String[]'>
    


  /**
   * Reference to a field of type 'DateTime'
   */
  export type DateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime'>
    


  /**
   * Reference to a field of type 'DateTime[]'
   */
  export type ListDateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime[]'>
    


  /**
   * Reference to a field of type 'Int'
   */
  export type IntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int'>
    


  /**
   * Reference to a field of type 'Int[]'
   */
  export type ListIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int[]'>
    
  /**
   * Deep Input Types
   */


  export type ConnectedAccountWhereInput = {
    AND?: ConnectedAccountWhereInput | ConnectedAccountWhereInput[]
    OR?: ConnectedAccountWhereInput[]
    NOT?: ConnectedAccountWhereInput | ConnectedAccountWhereInput[]
    id?: UuidFilter<"ConnectedAccount"> | string
    user_id?: UuidFilter<"ConnectedAccount"> | string
    provider?: StringFilter<"ConnectedAccount"> | string
    provider_account_id?: StringFilter<"ConnectedAccount"> | string
    email?: StringFilter<"ConnectedAccount"> | string
    label?: StringNullableFilter<"ConnectedAccount"> | string | null
    access_token?: StringFilter<"ConnectedAccount"> | string
    refresh_token?: StringFilter<"ConnectedAccount"> | string
    token_expires_at?: DateTimeFilter<"ConnectedAccount"> | Date | string
    scopes?: StringNullableListFilter<"ConnectedAccount">
    created_at?: DateTimeFilter<"ConnectedAccount"> | Date | string
    updated_at?: DateTimeFilter<"ConnectedAccount"> | Date | string
  }

  export type ConnectedAccountOrderByWithRelationInput = {
    id?: SortOrder
    user_id?: SortOrder
    provider?: SortOrder
    provider_account_id?: SortOrder
    email?: SortOrder
    label?: SortOrderInput | SortOrder
    access_token?: SortOrder
    refresh_token?: SortOrder
    token_expires_at?: SortOrder
    scopes?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type ConnectedAccountWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    user_id_provider_provider_account_id?: ConnectedAccountUser_idProviderProvider_account_idCompoundUniqueInput
    AND?: ConnectedAccountWhereInput | ConnectedAccountWhereInput[]
    OR?: ConnectedAccountWhereInput[]
    NOT?: ConnectedAccountWhereInput | ConnectedAccountWhereInput[]
    user_id?: UuidFilter<"ConnectedAccount"> | string
    provider?: StringFilter<"ConnectedAccount"> | string
    provider_account_id?: StringFilter<"ConnectedAccount"> | string
    email?: StringFilter<"ConnectedAccount"> | string
    label?: StringNullableFilter<"ConnectedAccount"> | string | null
    access_token?: StringFilter<"ConnectedAccount"> | string
    refresh_token?: StringFilter<"ConnectedAccount"> | string
    token_expires_at?: DateTimeFilter<"ConnectedAccount"> | Date | string
    scopes?: StringNullableListFilter<"ConnectedAccount">
    created_at?: DateTimeFilter<"ConnectedAccount"> | Date | string
    updated_at?: DateTimeFilter<"ConnectedAccount"> | Date | string
  }, "id" | "user_id_provider_provider_account_id">

  export type ConnectedAccountOrderByWithAggregationInput = {
    id?: SortOrder
    user_id?: SortOrder
    provider?: SortOrder
    provider_account_id?: SortOrder
    email?: SortOrder
    label?: SortOrderInput | SortOrder
    access_token?: SortOrder
    refresh_token?: SortOrder
    token_expires_at?: SortOrder
    scopes?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
    _count?: ConnectedAccountCountOrderByAggregateInput
    _max?: ConnectedAccountMaxOrderByAggregateInput
    _min?: ConnectedAccountMinOrderByAggregateInput
  }

  export type ConnectedAccountScalarWhereWithAggregatesInput = {
    AND?: ConnectedAccountScalarWhereWithAggregatesInput | ConnectedAccountScalarWhereWithAggregatesInput[]
    OR?: ConnectedAccountScalarWhereWithAggregatesInput[]
    NOT?: ConnectedAccountScalarWhereWithAggregatesInput | ConnectedAccountScalarWhereWithAggregatesInput[]
    id?: UuidWithAggregatesFilter<"ConnectedAccount"> | string
    user_id?: UuidWithAggregatesFilter<"ConnectedAccount"> | string
    provider?: StringWithAggregatesFilter<"ConnectedAccount"> | string
    provider_account_id?: StringWithAggregatesFilter<"ConnectedAccount"> | string
    email?: StringWithAggregatesFilter<"ConnectedAccount"> | string
    label?: StringNullableWithAggregatesFilter<"ConnectedAccount"> | string | null
    access_token?: StringWithAggregatesFilter<"ConnectedAccount"> | string
    refresh_token?: StringWithAggregatesFilter<"ConnectedAccount"> | string
    token_expires_at?: DateTimeWithAggregatesFilter<"ConnectedAccount"> | Date | string
    scopes?: StringNullableListFilter<"ConnectedAccount">
    created_at?: DateTimeWithAggregatesFilter<"ConnectedAccount"> | Date | string
    updated_at?: DateTimeWithAggregatesFilter<"ConnectedAccount"> | Date | string
  }

  export type ConnectedAccountCreateInput = {
    id?: string
    user_id: string
    provider: string
    provider_account_id: string
    email: string
    label?: string | null
    access_token: string
    refresh_token: string
    token_expires_at: Date | string
    scopes?: ConnectedAccountCreatescopesInput | string[]
    created_at?: Date | string
    updated_at?: Date | string
  }

  export type ConnectedAccountUncheckedCreateInput = {
    id?: string
    user_id: string
    provider: string
    provider_account_id: string
    email: string
    label?: string | null
    access_token: string
    refresh_token: string
    token_expires_at: Date | string
    scopes?: ConnectedAccountCreatescopesInput | string[]
    created_at?: Date | string
    updated_at?: Date | string
  }

  export type ConnectedAccountUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    provider?: StringFieldUpdateOperationsInput | string
    provider_account_id?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    label?: NullableStringFieldUpdateOperationsInput | string | null
    access_token?: StringFieldUpdateOperationsInput | string
    refresh_token?: StringFieldUpdateOperationsInput | string
    token_expires_at?: DateTimeFieldUpdateOperationsInput | Date | string
    scopes?: ConnectedAccountUpdatescopesInput | string[]
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ConnectedAccountUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    provider?: StringFieldUpdateOperationsInput | string
    provider_account_id?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    label?: NullableStringFieldUpdateOperationsInput | string | null
    access_token?: StringFieldUpdateOperationsInput | string
    refresh_token?: StringFieldUpdateOperationsInput | string
    token_expires_at?: DateTimeFieldUpdateOperationsInput | Date | string
    scopes?: ConnectedAccountUpdatescopesInput | string[]
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ConnectedAccountCreateManyInput = {
    id?: string
    user_id: string
    provider: string
    provider_account_id: string
    email: string
    label?: string | null
    access_token: string
    refresh_token: string
    token_expires_at: Date | string
    scopes?: ConnectedAccountCreatescopesInput | string[]
    created_at?: Date | string
    updated_at?: Date | string
  }

  export type ConnectedAccountUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    provider?: StringFieldUpdateOperationsInput | string
    provider_account_id?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    label?: NullableStringFieldUpdateOperationsInput | string | null
    access_token?: StringFieldUpdateOperationsInput | string
    refresh_token?: StringFieldUpdateOperationsInput | string
    token_expires_at?: DateTimeFieldUpdateOperationsInput | Date | string
    scopes?: ConnectedAccountUpdatescopesInput | string[]
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ConnectedAccountUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    user_id?: StringFieldUpdateOperationsInput | string
    provider?: StringFieldUpdateOperationsInput | string
    provider_account_id?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    label?: NullableStringFieldUpdateOperationsInput | string | null
    access_token?: StringFieldUpdateOperationsInput | string
    refresh_token?: StringFieldUpdateOperationsInput | string
    token_expires_at?: DateTimeFieldUpdateOperationsInput | Date | string
    scopes?: ConnectedAccountUpdatescopesInput | string[]
    created_at?: DateTimeFieldUpdateOperationsInput | Date | string
    updated_at?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UuidFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedUuidFilter<$PrismaModel> | string
  }

  export type StringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type StringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type DateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type StringNullableListFilter<$PrismaModel = never> = {
    equals?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    has?: string | StringFieldRefInput<$PrismaModel> | null
    hasEvery?: string[] | ListStringFieldRefInput<$PrismaModel>
    hasSome?: string[] | ListStringFieldRefInput<$PrismaModel>
    isEmpty?: boolean
  }

  export type SortOrderInput = {
    sort: SortOrder
    nulls?: NullsOrder
  }

  export type ConnectedAccountUser_idProviderProvider_account_idCompoundUniqueInput = {
    user_id: string
    provider: string
    provider_account_id: string
  }

  export type ConnectedAccountCountOrderByAggregateInput = {
    id?: SortOrder
    user_id?: SortOrder
    provider?: SortOrder
    provider_account_id?: SortOrder
    email?: SortOrder
    label?: SortOrder
    access_token?: SortOrder
    refresh_token?: SortOrder
    token_expires_at?: SortOrder
    scopes?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type ConnectedAccountMaxOrderByAggregateInput = {
    id?: SortOrder
    user_id?: SortOrder
    provider?: SortOrder
    provider_account_id?: SortOrder
    email?: SortOrder
    label?: SortOrder
    access_token?: SortOrder
    refresh_token?: SortOrder
    token_expires_at?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type ConnectedAccountMinOrderByAggregateInput = {
    id?: SortOrder
    user_id?: SortOrder
    provider?: SortOrder
    provider_account_id?: SortOrder
    email?: SortOrder
    label?: SortOrder
    access_token?: SortOrder
    refresh_token?: SortOrder
    token_expires_at?: SortOrder
    created_at?: SortOrder
    updated_at?: SortOrder
  }

  export type UuidWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedUuidWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type StringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type StringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type DateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type ConnectedAccountCreatescopesInput = {
    set: string[]
  }

  export type StringFieldUpdateOperationsInput = {
    set?: string
  }

  export type NullableStringFieldUpdateOperationsInput = {
    set?: string | null
  }

  export type DateTimeFieldUpdateOperationsInput = {
    set?: Date | string
  }

  export type ConnectedAccountUpdatescopesInput = {
    set?: string[]
    push?: string | string[]
  }

  export type NestedUuidFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedUuidFilter<$PrismaModel> | string
  }

  export type NestedStringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type NestedStringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type NestedDateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type NestedUuidWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedUuidWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type NestedIntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type NestedStringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type NestedStringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type NestedIntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }

  export type NestedDateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }



  /**
   * Batch Payload for updateMany & deleteMany & createMany
   */

  export type BatchPayload = {
    count: number
  }

  /**
   * DMMF
   */
  export const dmmf: runtime.BaseDMMF
}
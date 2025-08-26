/* Contains the general server action types. */
/**
 * @interface ActionState
 * @description Define el estado de retorno estandarizado para todas las Server Actions.
 * Puede ser un estado de éxito (`isSuccess: true`, `message`, y opcionalmente `data`)
 * o un estado de fracaso (`isSuccess: false`, `message`).
 * @template T El tipo de datos que se espera retornar en caso de éxito.
 * Si `T` es `undefined`, la propiedad `data` se omite en el objeto de éxito.
 */
export type ActionState<T> =
  | ({ isSuccess: true; message: string } & (T extends undefined
      ? {}
      : { data: T }))
  | { isSuccess: false; message: string }

/**
 * @function ok
 * @description Crea una respuesta de éxito estandarizada para una Server Action.
 * Si no se proporciona `data`, el tipo de retorno se ajusta para omitir la propiedad `data`.
 * @template T El tipo de datos que se retorna en caso de éxito.
 * @param {string} message Un mensaje descriptivo del éxito.
 * @param {T} [data] Los datos resultantes de la operación (opcional).
 * @returns {ActionState<T>} Un objeto ActionState que indica éxito.
 */
export function ok<T>(message: string, data?: T): ActionState<T> {
  if (data !== undefined) {
    return { isSuccess: true, message, data } as ActionState<T>
  }
  return { isSuccess: true, message } as ActionState<T>
}

/**
 * @function fail
 * @description Crea una respuesta de fracaso estandarizada para una Server Action.
 * @template T El tipo de datos que se esperaba retornar, usado para mantener la consistencia del tipo `ActionState`.
 * @param {string} message Un mensaje descriptivo del error o fracaso.
 * @returns {ActionState<T>} Un objeto ActionState que indica fracaso.
 */
export function fail<T>(message: string): ActionState<T> {
  return { isSuccess: false, message }
}

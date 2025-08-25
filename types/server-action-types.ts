/*
Contains the general server action types.
*/
export type ActionState<T> =
  | ({ isSuccess: true; message: string } & (T extends undefined
      ? {}
      : { data: T }))
  | { isSuccess: false; message: string }

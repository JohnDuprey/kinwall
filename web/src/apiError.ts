// Its own module so the demo data (mock.ts) can throw what the server would, without loading api.ts.
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

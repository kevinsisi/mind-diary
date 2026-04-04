import { Request, Response, NextFunction } from "express";

export const GUEST_USER_ID = 0;

/**
 * Sets req.userId and req.userRole from JWT cookie.
 * Stub: defaults to guest (user_id=0) until task 2.x JWT parsing is implemented.
 * Guests can access files and chat (public space), but not diary.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  // Default to guest; real JWT parsing added in task 2.x
  if ((req as any).userId === undefined) {
    req.userId = GUEST_USER_ID;
    req.userRole = "guest";
  }
  next();
}

/**
 * Requires an authenticated user (user_id > 0).
 * Returns 401 if the request is from a guest.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  optionalAuth(req, res, () => {
    if (req.userId === GUEST_USER_ID) {
      res.status(401).json({ error: "需要登入" });
      return;
    }
    next();
  });
}

import { ApiError } from '../api/errors.js';
import { formatDuration } from './format.js';

export interface Message {
  title: string;
  text: string;
}

/** Plain wording for a failed read. Authentication failures are handled globally (the session ends), not worded per screen. */
export function describeLoadError(error: ApiError): Message {
  switch (error.kind) {
    case 'network':
      return {
        title: "We can't reach Nook",
        text: 'Check your internet connection and try again.',
      };
    case 'notFound':
      return {
        title: "We couldn't find that",
        text: 'It may not exist, or it may not be something you can view.',
      };
    case 'rateLimited':
      return { title: 'Too many requests', text: 'Please wait a moment and try again.' };
    case 'unauthorized':
      return { title: 'Your session has ended', text: 'Please sign in again to continue.' };
    case 'server':
      return {
        title: 'Something went wrong on our side',
        text: 'This is not your fault. Please try again in a moment.',
      };
    default:
      return {
        title: 'Something went wrong',
        text: 'Please try again. If it keeps happening, contact your hostel.',
      };
  }
}

/** The code was accepted but the browser did not end up with a session (for example it dropped the cookie). Nothing internal is shown. */
export function describeNoSession(): Message {
  return {
    title: "We couldn't finish signing you in",
    text: 'Your code was accepted, but your browser did not keep the sign-in. Make sure cookies are allowed for this site, then request a new code and try again.',
  };
}

/** Why a code could not be sent. The API answers the same way for every valid number, so none of this reveals whether a number has access. */
export function describeRequestCodeError(error: ApiError): Message {
  if (error.kind === 'badRequest')
    return {
      title: 'Check your number',
      text: 'Enter a valid 10-digit mobile number starting with 6, 7, 8 or 9.',
    };
  if (error.kind === 'rateLimited')
    return { title: 'Too many codes requested', text: waitText(error) };
  if (error.kind === 'network')
    return { title: "We can't reach Nook", text: 'Check your internet connection and try again.' };
  if (error.kind === 'notFound')
    return {
      title: 'The resident portal is not available right now',
      text: 'Please try again later, or contact your hostel.',
    };
  if (error.kind === 'server')
    return {
      title: 'Something went wrong on our side',
      text: 'We could not send a code. Please try again in a moment.',
    };
  return { title: 'We could not send a code', text: 'Please try again.' };
}

/**
 * Why a code was refused. By design the API never says whether a code was wrong or expired (or whether the number has access),
 * so neither does this: one honest message that covers each case and tells the resident what to do next.
 */
export function describeVerifyError(error: ApiError): Message {
  if (error.kind === 'unauthorized')
    return {
      title: 'That code did not work',
      text: 'It may be incorrect or expired. Check the code, or go back and request a new one.',
    };
  if (error.kind === 'rateLimited') return { title: 'Too many attempts', text: waitText(error) };
  if (error.kind === 'network')
    return { title: "We can't reach Nook", text: 'Check your internet connection and try again.' };
  if (error.kind === 'server')
    return {
      title: 'Something went wrong on our side',
      text: 'We could not check your code. Please try again in a moment.',
    };
  return { title: 'We could not check your code', text: 'Please try again.' };
}

function waitText(error: ApiError): string {
  return error.retryAfterSeconds && error.retryAfterSeconds > 0
    ? `Please try again in ${formatDuration(error.retryAfterSeconds)}.`
    : 'Please wait a little while before trying again.';
}

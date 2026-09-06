import { clearToken, getToken, setToken } from "./authSession";

export function getStudentSession() {
  return getToken("student");
}

export function setStudentSession(token) {
  setToken("student", token);
}

export function clearStudentSession() {
  clearToken("student");
}

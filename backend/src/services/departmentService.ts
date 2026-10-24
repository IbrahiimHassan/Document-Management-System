import * as departmentRepository from "../repositories/departmentRepository.js";

export function listDepartments() {
  return departmentRepository.list();
}
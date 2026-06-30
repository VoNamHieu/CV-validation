// Single source of truth for the 23-field profile shape consumed by the
// Latosa extension popup and content-agent autofill. Maps a CVData
// object into the flat shape the extension expects.

import type { CVData } from "@/lib/types";

export interface ExtensionProfile {
    fullName: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    dateOfBirth: string;
    gender: string;
    nationality: string;
    maritalStatus: string;
    addressProvince: string;
    addressDistrict: string;
    addressStreet: string;
    currentTitle: string;
    currentLevel: string;
    yearsOfExperience: number;
    highestDegree: string;
    currentSalary: string;
    currentIndustry: string;
    currentFields: string;
    desiredLocations: string;
    desiredSalary: string;
    coverLetter: string;
    skills: string;
}

export function cvToExtensionProfile(cv: CVData): ExtensionProfile {
    const nameParts = (cv.name ?? "").trim().split(/\s+/);
    const firstName = nameParts.length > 0 ? nameParts[nameParts.length - 1] : "";
    const lastName = nameParts.slice(0, -1).join(" ");

    const contact = cv.contact ?? ({} as CVData["contact"]);
    const personal = cv.personal ?? ({} as CVData["personal"]);
    const employment = cv.employment ?? ({} as CVData["employment"]);
    const preferences = cv.preferences ?? ({} as CVData["preferences"]);

    const currentTitle =
        employment.current_title || cv.experience?.[0]?.title || "";
    const yearsOfExperience =
        employment.years_of_experience || cv.experience?.length || 0;
    const highestDegree =
        employment.highest_degree || cv.education?.[0]?.degree || "";

    return {
        fullName: cv.name ?? "",
        firstName,
        lastName,
        email: contact.email ?? "",
        phone: contact.phone ?? "",
        dateOfBirth: personal.date_of_birth ?? "",
        gender: personal.gender ?? "",
        nationality: personal.nationality ?? "",
        maritalStatus: personal.marital_status ?? "",
        addressProvince: contact.address_province ?? "",
        addressDistrict: contact.address_district ?? "",
        addressStreet: contact.address_street ?? "",
        currentTitle,
        currentLevel: employment.current_level ?? "",
        yearsOfExperience,
        highestDegree,
        currentSalary: employment.current_salary ?? "",
        currentIndustry: employment.current_industry ?? "",
        currentFields: employment.current_fields ?? "",
        desiredLocations: preferences.desired_locations ?? "",
        desiredSalary: preferences.desired_salary ?? "",
        coverLetter: cv.summary ?? "",
        skills: (cv.skills ?? []).join(", "),
    };
}

// Local candidate profile for Workday autofill (CommonJS so the server can require it).
// Field names match the reference information.js; workdayProfile.js normalizes them
// to the snake_case keys workday.js consumes.
class WorkExperience {
    constructor({
        jobtitle,
        company,
        location,
        startDateMonth,
        startDateYear,
        endDateMonth,
        endDateYear,
        description,
    }) {
        this.jobtitle = jobtitle;
        this.company = company;
        this.location = location;
        this.startDateMonth = startDateMonth;
        this.startDateYear = startDateYear;
        this.endDateMonth = endDateMonth;
        this.endDateYear = endDateYear;
        this.description = description;
    }
}

const email = "email@gmail.com";
const password = "password";
const fullName = "Ayush Pratap Singh";
const firstName = "Ayush";
const lastName = "Pratap Singh";
const suffix = "Mr";
const street = "1600 Amphitheatre Parkway";
const city = "Mountain View"
const state = "California";
const postalCode = "94043";
const phoneType = "Mobile";
const phoneNumber = "6448227xxx";

const workexperiences = [
    new WorkExperience({
        jobtitle: 'Tech/Cyber Apprentice',
        company: 'Morgan Stanley',
        location: 'Bengalaru',
        startDateMonth: '08',
        startDateYear: '2025',
        endDateMonth: '08',
        endDateYear: '2026',
        description: `Backend Software Engineer with experience building enterprise-scale cyber risk and compliance platforms at Morgan Stanley. Skilled in Python, FastAPI, Apache Kafka, Apache Airflow, Neo4j, and AWS, with experience developing event-driven systems, ETL pipelines, automated validation frameworks, and AI-powered RAG applications. Passionate about distributed systems, backend architecture, and building scalable, reliable software.`
    })
]

const school = "Chitkara University";
const degree = "Bachelors";
const fieldOfStudy = "Computer Science";
const gpa = "9.32";
const skills = ["Python", "SQL", "Apache Airflow", "Apache Kafka", "AWS", "Data Engineering", "Data Structures & Algorithms", "Docker", "ETL", "Express.js", "FastAPI", "Git", "HTML / CSS", "Java", "JavaScript", "Jenkins", "Julia", "LangChain", "LangGraph", "Linux / Unix", "LLM", "MongoDB", "Next.js", "Node.js", "Operating Systems", "Postgres", "Python", "RAG", "React.js", "Redux.js", "SQL", "TypeScript"];
const websites = ["https://github.com/tomar-ayush"]
const startDate = "2022";
const endDate = "2026";
const resumeFilePath = "./blank.txt";
const linkedInLink = "https://www.linkedin.com/in/ayush-pratap-singh1/";
const githubLink = "https://github.com/tomar-ayush";

const gender = "Male";
const ethnicity = "Asian";
const hispanicOrLatino = "No";
const veteranStatus = "I am not a veteran";
const disability = "no"; // Either "yes", "no", or "abstain" (prefer not to say)

module.exports = {
    email, password, fullName, firstName, lastName, suffix, street, city, state, postalCode, phoneType, phoneNumber, workexperiences, school, degree, fieldOfStudy, gpa, skills, websites, startDate, endDate, resumeFilePath, linkedInLink, githubLink, gender, ethnicity, hispanicOrLatino, veteranStatus, disability,
};
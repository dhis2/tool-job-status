"use strict";

import { d2Get } from "./js/d2api.js";
import $ from "jquery";
import "datatables.net";
import "materialize-css";
import "./css/style.css";
import "materialize-css/dist/css/materialize.min.css";
import "datatables.net-dt/css/dataTables.dataTables.css";

let dataTable;

window.onload = function () {
    initializeDataTable();
    pollJobConfigurations();
    $(".modal").modal(); // Initialize modals
};

function pollJobConfigurations() {
    setInterval(async () => {
        try {
            const data = await d2Get("/api/jobConfigurations?fields=*");
            
            window.renderRunningJobs(data.jobConfigurations);
            window.updateJobsTable(data.jobConfigurations);

            // Integrate the task fetching function here
            fetchAndDisplayRunningJobTasks(data.jobConfigurations);
        } catch (error) {
            console.error("Failed to fetch job configurations:", error);
        }
    }, 1000); // Poll every second
}


window.renderRunningJobs = function (jobs) {
    const container = document.getElementById("runningJobsContainer");
    container.innerHTML = ""; // Clear previous entries
    
    // Create a map to hold jobs by their queue name
    const queueMap = jobs.reduce((map, job) => {
        const queueName = job.queueName || "independent";
        if (!map[queueName]) {
            map[queueName] = [];
        }
        map[queueName].push(job);
        return map;
    }, {});

    let hasRunningQueue = false;
    
    Object.keys(queueMap).forEach((queueName) => {
        const queueJobs = queueMap[queueName];
        
        // Check if any job in the queue is running
        if (queueJobs.some(job => job.jobStatus === "RUNNING")) {
            hasRunningQueue = true;
            
            // Sort jobs within each queue by position
            queueJobs.sort((a, b) => a.queuePosition - b.queuePosition);
            
            queueJobs.forEach((job) => {
                const card = job.jobType === "ANALYTICS_TABLE" 
                    ? createAnalyticsTableCard(job) 
                    : createDefaultCard(job);

                // Add Queue Position Label
                const queueLabel = document.createElement("div");
                queueLabel.className = "queue-label";
                queueLabel.textContent = `Job ${job.queuePosition + 1} of ${queueJobs.length}`;
                card.appendChild(queueLabel);

                // Set visual indication for job status
                if (job.jobStatus === "RUNNING") {
                    card.classList.add("running-job");
                } else if (job.jobStatus === "COMPLETED") {
                    card.classList.add("completed-job");
                } else if (job.jobStatus === "DISABLED" || job.jobStatus === "SCHEDULED") {
                    card.classList.add("upcoming-job");
                }
                
                container.appendChild(card);
            });
        }
    });

    // If no running jobs or running queues are displayed
    if (!hasRunningQueue) {
        container.innerHTML = "<div class=\"card\"><div class=\"card-title\">No running jobs</div></div>";
    }
};



function createAnalyticsTableCard(job) {
    const titleRegex = /^ANALYTICS_TABLE \(\d+\)$/;
    const displayName = titleRegex.test(job.displayName) ? "Analytics table (manual run)" : job.displayName;
    const years = job.jobParameters.years || "All";
    const status = job.jobStatus || "Unknown";

    const card = document.createElement("div");
    card.className = "card analytics-card"; 
    card.innerHTML = `
        <div class="card-title">${displayName}</div>
        <div>Status: ${status}</div>
        <div>ID: ${job.id}</div>
        <div>Years: ${years}</div>
        ${renderAnalyticsParametersTable(job.jobParameters)}
        <button class="btn modal-trigger" data-target="jobInfoModal" onclick="showJobInfoModal('${job.jobType}', '${job.id}')">View Details</button>
    `;
    return card;
}

async function fetchAndDisplayRunningJobTasks(jobs) {
    try {
        const runningJobsDetails = jobs
            .filter(job => job.jobStatus === "RUNNING")
            .map(job => ({ type: job.jobType, id: job.id }));

        if (runningJobsDetails.length > 0) {
            const taskMessages = [];

            for (const jobDetail of runningJobsDetails) {
                try {
                    const tasks = await d2Get(`/api/system/tasks/${jobDetail.type}/${jobDetail.id}`);

                    const categorizedMessages = categorizeMessages(tasks);

                    taskMessages.push(formatCategorizedMessages(categorizedMessages));
                } catch (error) {
                    console.error(`Error fetching tasks for job ${jobDetail.id}:`, error);
                    taskMessages.push(`Error fetching tasks for job ${jobDetail.id}.`);
                }
            }

            document.getElementById("tickerContent").innerHTML = taskMessages.join("<hr>");
        } else {
            document.getElementById("tickerContent").textContent = "No running tasks.";
        }
    } catch (error) {
        console.error("Error processing running jobs:", error);
        document.getElementById("tickerContent").textContent = "Error processing running jobs.";
    }
}

function categorizeMessages(tasks) {
    const grouped = {
        currentTask: [],
        completed: [],
        info: [],
        loop: [],
    };

    tasks.forEach(task => {
        if (task.completed) {
            grouped.completed.push(task);
        } else if (task.level === "LOOP") {
            grouped.loop.push(task);
        } else {
            grouped.info.push(task);
            if (task.level === "INFO") {
                grouped.currentTask.push(task);
            }
        }
    });

    return grouped;
}

function formatCategorizedMessages(categorizedMessages) {
    let formatted = "";

    if (categorizedMessages.currentTask.length > 0) {
        formatted += "<strong>Current Task</strong><br>";
        formatted += categorizedMessages.currentTask.slice(-3).map(task => `${task.time} - ${task.message}`).join("<br>");
    }

    if (categorizedMessages.completed.length > 0) {
        formatted += "<strong>Completed:</strong><br>";
        formatted += categorizedMessages.completed.slice(-3).map(task => `${task.time} - ${task.message}`).join("<br>");
    }

    if (categorizedMessages.info.length > 0) {
        formatted += "<strong>Info:</strong><br>";
        formatted += categorizedMessages.info.slice(-3).map(task => `${task.time} - ${task.message}`).join("<br>");
    }

    if (categorizedMessages.loop.length > 0) {
        formatted += "<strong>Loop:</strong><br>";
        formatted += categorizedMessages.loop.slice(-3).map(task => `${task.time} - ${task.message}`).join("<br>");
    }

    return formatted;
}


function renderAnalyticsParametersTable(params = {}) {
    const skipTables = Array.isArray(params.skipTableTypes)
        ? params.skipTableTypes
        : typeof params.skipTableTypes === "string"
            ? params.skipTableTypes.split(",")
            : [];
    const skipPrograms = Array.isArray(params.skipPrograms)
        ? params.skipPrograms
        : typeof params.skipPrograms === "string"
            ? params.skipPrograms.split(",")
            : [];

    const tableElements = [
        "COMPLETENESS",
        "TRACKED_ENTITY_INSTANCE_EVENTS",
        "OWNERSHIP",
        "TRACKED_ENTITY_INSTANCE",
        "DATA_VALUE",
        "EVENT",
        "ENROLLMENT",
        "COMPLETENESS_TARGET",
        "TRACKED_ENTITY_INSTANCE_ENROLLMENTS",
        "RESOURCE_TABLES",
        "OUTLIER_STATISTICS",
    ];

    let tableHTML = `
    <table class="parameter-table">
        <thead><tr><th>Element</th><th>Included</th></tr></thead><tbody>
        ${tableElements
        .map(
            (element) => `
            <tr>
                <td>${element}</td>
                <td>${isIncluded(element, skipTables, params)}</td>
            </tr>`
        )
        .join("")}
        <tr><td>Skipped programs</td><td>${skipPrograms.join(", ")}</td></tr>
    </tbody></table>
    `;

    return tableHTML;
}

function isIncluded(element, skipTables, params) {
    if (["RESOURCE_TABLES"].includes(element)) {
        return params.skipResourceTables === true ? "No" : "Yes";
    }
    if (["OUTLIER_STATISTICS"].includes(element)) {
        return params.skipOutliers === true ? "No" : "Yes";
    }
    return skipTables.includes(element) ? "No" : "Yes";
}

function createDefaultCard(job) {
    const formattedParameters = formatJobParameters(job.jobParameters);
    const status = job.jobStatus || "Unknown";

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
        <div class="card-title">${job.displayName}</div>
        <div>Status: ${status}</div>
        <div>Job Type: ${job.jobType}</div>
        <div>Last Executed: ${job.lastExecuted || "N/A"}</div>
        <div>Last Runtime: ${job.lastRuntimeExecution || "N/A"}</div>
        ${formattedParameters}
        <button class="btn modal-trigger" data-target="jobInfoModal" onclick="showJobInfoModal('${job.jobType}', '${job.id}')">View Details</button>
    `;
    return card;
}

window.showJobInfoModal = async function (jobType, jobId) {
    try {
        const tasks = await d2Get(`/api/system/tasks/${jobType}/${jobId}`);
        const formattedTasks = tasks.map(task => `
            <div><strong>${task.time}</strong>: ${task.message}</div>
        `).join("");
        
        document.getElementById("jobInfoModalContent").innerHTML = formattedTasks;
        $("#jobInfoModal").modal("open");
    } catch (error) {
        document.getElementById("jobInfoModalContent").innerHTML = "Error loading task details.";
        console.error("Error fetching task details:", error);
    }
};

function formatJobParameters(params) {
    if (!params) return "<div>No parameters available</div>";

    let formattedParams = "";
    formattedParams +=
        "<table class=\"parameter-table\"><thead><tr><th>Parameter</th><th>Value</th></tr></thead><tbody>";
    for (let key in params) {
        if (Object.prototype.hasOwnProperty.call(params, key)) { // safer check
            formattedParams += `<tr><td>${key}</td><td>${params[key]}</td></tr>`;
        }
    }
    formattedParams += "</tbody></table>";

    return formattedParams;
}


window.updateJobsTable = function (jobs) {
    const nonSystemJobs = jobs.filter((job) => !isSystemJob(job));

    const queueMap = nonSystemJobs.reduce((map, job) => {
        const queueName = job.queueName || "independent";
        if (!map[queueName]) {
            map[queueName] = [];
        }
        map[queueName].push(job);
        return map;
    }, {});

    const rowsData = [];
    Object.keys(queueMap).forEach((queueName) => {
        const queueJobs = queueMap[queueName];

        queueJobs.sort((a, b) => {
            const aTime = a.nextExecutionTime || "";
            const bTime = b.nextExecutionTime || "";
            return bTime.localeCompare(aTime);
        });

        const queueSize = queueJobs.length;
        queueJobs.forEach((job) => {
            const queueIndicator = job.queueName
                ? `[Q ${job.queuePosition} of ${queueSize}] `
                : "";
            const switchControl = `<label><input type="checkbox" ${
                job.enabled ? "checked" : ""
            }><div></div></label>`;
            const infoIcon = `<a href="#" class="waves-effect waves-light modal-trigger" data-target="jobInfoModal" onclick="showJobInfo('${JSON.stringify(
                job.jobParameters || {}
            )}')"><i class="material-icons">info</i></a>`;

            rowsData.push([
                `${queueIndicator} ${job.displayName}`,
                job.id,
                job.jobType,
                job.schedulingType,
                job.nextExecutionTime || "N/A",
                job.jobStatus,
                switchControl,
                infoIcon,
            ]);
        });
    });

    dataTable.clear().rows.add(rowsData).draw(false);
};



function initializeDataTable() {
    dataTable = $("#jobsTable").DataTable({
        retrieve: true,
        paging: true,
        pageLength: 50,
        autoWidth: false,
        responsive: true,
        order: [[4, "desc"]],
    });
}

function isSystemJob(job) {
    return job.jobType.includes("SYSTEM");
}

window.showJobInfo = function (jobParameters) {
    try {
        const parsedParameters = JSON.parse(jobParameters || "{}");
        document.getElementById("jobParamsContent").innerHTML =
            formatJobParameters(parsedParameters);
    } catch (error) {
        document.getElementById("jobParamsContent").innerHTML =
            "No parameters available or invalid format";
        console.error("Error parsing job parameters:", error);
    }
    $("#jobInfoModal").modal("open");
};

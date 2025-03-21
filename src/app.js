"use strict";

import { d2Get } from "./js/d2api.js";
import $ from "jquery";
import "materialize-css";
import "./css/style.css";
import "materialize-css/dist/css/materialize.min.css";

let modalInterval; // Variable to store the modal polling interval
let activeJobId; // Store current active job id for the modal
let activeJobType; // Store current active job type for the modal


window.onload = function () {
    pollJobConfigurations();

    // Initialize modals with appropriate callbacks
    $("#jobInfoModal").modal({
        onOpenStart: function() {
            if (activeJobType && activeJobId) {
                startModalPolling(activeJobType, activeJobId);
            }
        },
        onCloseEnd: function() {
            clearInterval(modalInterval);
        }
    });
};


function pollJobConfigurations() {
    setInterval(async () => {
        try {
            const data = await d2Get("/api/jobConfigurations?fields=*");
            
            window.renderRunningJobs(data.jobConfigurations);
            window.updateJobLists(data.jobConfigurations); // Update the lists for last and upcoming jobs
        } catch (error) {
            console.error("Failed to fetch job configurations:", error);
        }
    }, 5000); // Poll every 5 seconds
}

function startModalPolling(jobType, jobId) {
    // Prevent polling if not active
    if (!jobType || !jobId) return;

    clearInterval(modalInterval);  // Clear any existing interval

    // Begin new interval
    modalInterval = setInterval(async () => {
        try {
            const tasks = await d2Get(`/api/system/tasks/${jobType}/${jobId}`);
            const formattedTasks = tasks.slice(0, 5).map(task => `
                <div><strong>${task.time}</strong>: ${task.message}</div>
            `).join("");

            document.getElementById("jobInfoModalContent").innerHTML = formattedTasks;
        } catch (error) {
            document.getElementById("jobInfoModalContent").innerHTML = "Error loading task details.";
            console.error("Error fetching task details:", error);
        }
    }, 5000); // Update interval based on requirements
}


window.renderRunningJobs = function (jobs) {
    const container = document.getElementById("runningJobsContainer");
    container.innerHTML = ""; // Clear previous entries

    // Construct a map of running jobs by queue name
    const queueMap = jobs.reduce((map, job) => {
        if (job.jobStatus === "RUNNING" && job.jobType !== "HOUSEKEEPING") {
            const queueName = job.queueName || "Independent"; // Default to 'Independent' for unqueued jobs
            if (!map[queueName]) {
                map[queueName] = [];
            }
            map[queueName].push(job);
        }
        return map;
    }, {});

    let hasRunningJobs = false;

    Object.keys(queueMap).forEach((queueName) => {
        const queueJobs = queueMap[queueName];
        hasRunningJobs = hasRunningJobs || queueJobs.length > 0;

        // Sort the jobs within each queue by 'queuePosition'
        queueJobs.sort((a, b) => a.queuePosition - b.queuePosition);

        const queueContainer = document.createElement("div");
        queueContainer.className = "queue-container";
        const queueLabel = document.createElement("h5");
        queueLabel.textContent = `Queue: ${queueName}`;
        queueContainer.appendChild(queueLabel);

        // Render sorted jobs, showing position within the queue
        queueJobs.forEach((job, index) => {
            const card = job.jobType === "ANALYTICS_TABLE"
                ? createAnalyticsTableCard(job)
                : createDefaultCard(job);

            // Label showing the position of job in the queue
            const positionLabel = document.createElement("div");
            positionLabel.className = "position-label";
            positionLabel.textContent = `Job ${job.queuePosition + 1} of ${queueJobs.length}`;
            card.appendChild(positionLabel);

            queueContainer.appendChild(card);
        });

        container.appendChild(queueContainer);
    });

    if (!hasRunningJobs) {
        container.innerHTML = "<div class=\"card\"><div class=\"card-title\">No running jobs</div></div>";
    }
};




window.updateJobLists = function (jobs) {

    jobs = jobs.filter(job => job.jobType !== "HOUSEKEEPING");

    const completedJobs = jobs
        .filter(job => job.lastExecutedStatus)
        .sort((a, b) => new Date(b.lastFinished) - new Date(a.lastFinished))
        .slice(0, 6);

    const upcomingJobs = jobs
        .filter(job => job.jobStatus === "SCHEDULED" && job.nextExecutionTime)
        .sort((a, b) => new Date(a.nextExecutionTime) - new Date(b.nextExecutionTime))
        .slice(0, 6);

    renderJobList("lastJobsContainer", "Last Jobs", completedJobs, "lastFinished", "lastExecutedStatus", formatLastJobDetails);
    renderJobList("upcomingJobsContainer", "Upcoming Jobs", upcomingJobs, "nextExecutionTime", null, formatUpcomingJobDetails);
};

function renderJobList(containerId, title, jobs, timeField, statusField = null, formatJobDetails) {
    const container = document.getElementById(containerId);
    
    const card = document.createElement("div");
    card.className = "job-list-card";
    card.innerHTML = `<h4>${title}</h4>`;

    const list = document.createElement("ul");
    list.className = "job-list";

    jobs.forEach(job => {
        const listItem = document.createElement("li");
        listItem.innerHTML = formatJobDetails(job, timeField, statusField);
        list.appendChild(listItem);
    });

    card.appendChild(list);
    container.innerHTML = "";  // Ensure container is cleared
    container.appendChild(card);
}

function formatLastJobDetails(job, timeField, statusField) {
    return `
        <div><strong>${job.displayName}</strong></div>
        <div>Type: ${job.jobType}</div>
        <div>ID: ${job.id}</div>
        <div>Status: ${job[statusField]}</div>
        <div>Last Executed: ${job.lastExecuted || "N/A"}</div>
        <div>Last Runtime: ${job.lastRuntimeExecution || "N/A"}</div>
        <button class="btn modal-trigger small-btn" data-target="jobInfoModal" onclick="showJobInfoModal('${job.jobType}', '${job.id}')">Show Details</button>
    `;
}

function formatUpcomingJobDetails(job, timeField) {
    return `
        <div><strong>${job.displayName}</strong></div>
        <div>Type: ${job.jobType}</div>
        <div>Status: ${job.jobStatus}</div>
        <div>Next run: ${formatTimeUntilNextRun(job[timeField]) || "N/A"}</div>
    `;
}

function formatTimeUntilNextRun(nextExecutionTime) {
    const now = new Date();
    const nextRunTime = new Date(nextExecutionTime);
    const diffInMinutes = Math.floor((nextRunTime - now) / 60000);
    const hours = Math.floor(diffInMinutes / 60);
    const minutes = diffInMinutes % 60;
    return `${hours}h ${minutes}m`;
}


window.showJobInfoModal = async function (jobType, jobId) {
    activeJobType = jobType; // Set active job type
    activeJobId = jobId; // Set active job id
    try {
        const tasks = await d2Get(`/api/system/tasks/${jobType}/${jobId}`);
        const formattedTasks = tasks.slice(0, 5).map(task => `
            <div><strong>${task.time}</strong>: ${task.message}</div>
        `).join("");

        document.getElementById("jobInfoModalContent").innerHTML = formattedTasks;
        $("#jobInfoModal").modal("open");
    } catch (error) {
        document.getElementById("jobInfoModalContent").innerHTML = "Error loading task details.";
        console.error("Error fetching task details:", error);
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
        <div class="card-footer">
            <button class="btn modal-trigger" data-target="jobInfoModal" onclick="showJobInfoModal('${job.jobType}', '${job.id}')">View Details</button>
        </div>
    `;
    return card;
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
        <div class="card-footer">
            <button class="btn modal-trigger" data-target="jobInfoModal" onclick="showJobInfoModal('${job.jobType}', '${job.id}')">View Details</button>
        </div>
    `;
    return card;
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

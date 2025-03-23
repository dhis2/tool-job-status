"use strict";

import { d2Get } from "./js/d2api.js";
import $ from "jquery";
import "materialize-css";
import "./css/style.css";
import "materialize-css/dist/css/materialize.min.css";

let modalInterval; // Variable to store the modal polling interval
let activeJobId; // Store current active job id for the modal
let activeJobType; // Store current active job type for the modal
let activeTaskPolls = new Map(); // Store polling intervals for running tasks

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

// Add new function to check if a job is running based on its tasks
function isJobRunning(jobType, jobId, taskMap) {
    if (!taskMap || !taskMap[jobType] || !taskMap[jobType][jobId]) {
        return false;
    }

    const tasks = taskMap[jobType][jobId];
    const lastTask = tasks[0];
    
    if (!lastTask) return false;
    
    return !lastTask.completed && lastTask.level !== 'ERROR';
}

// Modify pollJobConfigurations to fetch both configurations and tasks
function pollJobConfigurations() {
    setInterval(async () => {
        try {
            const [configData, tasksData] = await Promise.all([
                d2Get("/api/jobConfigurations?paging=false&fields=id,jobType,jobStatus,displayName,jobParameters," + 
                      "lastExecuted,lastExecutedStatus,lastFinished,lastRuntimeExecution,nextExecutionTime," +
                      "queueName,queuePosition"),
                d2Get("/api/system/tasks")
            ]);
            
            // Enhance job configurations with task status
            const enhancedJobs = configData.jobConfigurations.map(job => ({
                ...job,
                isRunning: job.jobStatus === 'RUNNING' || isJobRunning(job.jobType, job.id, tasksData)
            }));

            window.renderRunningJobs(enhancedJobs);
            window.updateJobLists(enhancedJobs);
        } catch (error) {
            console.error("Failed to fetch job data:", error);
        }
    }, 5000);
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

// Update the extractProgressFromTask function to handle action message better
function extractProgressFromTask(tasks) {
    const latestTask = tasks[0];
    if (latestTask?.level === 'LOOP') {
        const match = latestTask.message.match(/\[(\d+)\/(\d+)\]/);
        if (match) {
            const current = parseInt(match[1]);
            const total = parseInt(match[2]);
            const percentage = Math.round((current / total) * 100);
            
            // Find the first non-LOOP message for action description
            const actionTask = tasks.find(task => task.level !== 'LOOP');
            const action = actionTask ? actionTask.message : 'Processing';
            
            return { percentage, action, isLoop: true };
        }
    }
    return { message: latestTask?.message, isLoop: false };
}

function startTaskPolling(jobType, jobId) {
    if (activeTaskPolls.has(jobId)) {
        return; // Already polling this job
    }

    let lastMessage = '';
    let lastAction = null;
    let lastPercentage = null;
    
    const pollInterval = setInterval(async () => {
        try {
            const tasks = await d2Get(`/api/system/tasks/${jobType}/${jobId}`);
            const result = extractProgressFromTask(tasks);
            
            const progressDiv = document.getElementById(`progress-${jobId}`);
            if (progressDiv) {
                let newMessage = lastMessage; // Start with previous message
                
                if (result.isLoop) {
                    // Update action if new one is available
                    if (result.action) lastAction = result.action;
                    
                    // Only update if percentage changed or we have a new action
                    if (result.percentage !== lastPercentage || !newMessage) {
                        newMessage = `<div>${lastAction}<br>${result.percentage}% complete</div>`;
                        lastPercentage = result.percentage;
                    }
                } else if (tasks[0]?.level === 'INFO') {
                    // Store new action message
                    lastAction = result.message;
                    newMessage = `<div>${result.message}</div>`;
                    lastPercentage = null;
                }

                // Only update DOM if message content actually changed
                if (newMessage !== lastMessage) {
                    progressDiv.innerHTML = newMessage;
                    lastMessage = newMessage;
                }
            }
        } catch (error) {
            console.error(`Error polling tasks for job ${jobId}:`, error);
        }
    }, 5000);

    activeTaskPolls.set(jobId, pollInterval);
}

// Modify createAnalyticsTableCard and createDefaultCard to show empty progress div initially
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
        <div id="progress-${job.id}" class="progress-info"></div>
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
        <div id="progress-${job.id}" class="progress-info"></div>
        <div class="card-footer">
            <button class="btn modal-trigger" data-target="jobInfoModal" onclick="showJobInfoModal('${job.jobType}', '${job.id}')">View Details</button>
        </div>
    `;
    return card;
}

// Modify renderRunningJobs to use isRunning property
window.renderRunningJobs = function(jobs) {
    const container = document.getElementById("runningJobsContainer");
    container.innerHTML = ""; // Clear previous entries

    // 1. Find all queues that have at least one running job
    const activeQueues = new Set(
        jobs
            .filter(job => job.isRunning && job.jobType !== "HOUSEKEEPING" && job.queueName)
            .map(job => job.queueName)
    );

    // 2. Group jobs into queued and independent
    const queueMap = jobs.reduce((map, job) => {
        if (job.queueName && activeQueues.has(job.queueName)) {
            if (!map[job.queueName]) {
                map[job.queueName] = [];
            }
            map[job.queueName].push(job);
        }
        return map;
    }, {});

    // Handle independent running jobs separately
    const independentJobs = jobs.filter(job => 
        !job.queueName && 
        job.isRunning && 
        job.jobType !== "HOUSEKEEPING"
    );

    let hasActiveJobs = Object.keys(queueMap).length > 0 || independentJobs.length > 0;

    // 3. Render queued jobs
    Object.keys(queueMap).forEach(queueName => {
        const queueJobs = queueMap[queueName];
        const queueContainer = document.createElement("div");
        queueContainer.className = "queue-container";

        // Sort jobs within each queue by queuePosition
        queueJobs.sort((a, b) => a.queuePosition - b.queuePosition);

        const queueLabel = document.createElement("h5");
        queueLabel.textContent = `${queueName}`;
        queueContainer.appendChild(queueLabel);

        queueJobs.forEach((job, index) => {
            const card = job.jobType === "ANALYTICS_TABLE"
                ? createAnalyticsTableCard(job)
                : createDefaultCard(job);

            card.classList.add(getJobStatusClass(job.jobStatus));

            const positionLabel = document.createElement("div");
            positionLabel.className = "position-label";
            positionLabel.textContent = `Job ${index + 1} of ${queueJobs.length}`;
            card.appendChild(positionLabel);

            queueContainer.appendChild(card);
        });

        container.appendChild(queueContainer);
    });

    // 4. Render independent running jobs
    if (independentJobs.length > 0) {
        const independentContainer = document.createElement("div");
        independentContainer.className = "queue-container";

        const independentLabel = document.createElement("h5");
        independentLabel.textContent = "Now running";
        independentContainer.appendChild(independentLabel);

        independentJobs.forEach(job => {
            const card = job.jobType === "ANALYTICS_TABLE"
                ? createAnalyticsTableCard(job)
                : createDefaultCard(job);

            card.classList.add(getJobStatusClass(job.jobStatus));
            independentContainer.appendChild(card);
        });

        container.appendChild(independentContainer);
    }

    if (!hasActiveJobs) {
        container.innerHTML = "<div class=\"card\"><div class=\"card-title\">No running jobs</div></div>";
    }

    // Clear existing polls for jobs that are no longer running
    for (const [jobId, interval] of activeTaskPolls.entries()) {
        if (!jobs.some(job => job.id === jobId && job.isRunning)) {
            clearInterval(interval);
            activeTaskPolls.delete(jobId);
        }
    }

    // Start polling for running jobs
    jobs.forEach(job => {
        if (job.isRunning) {
            startTaskPolling(job.jobType, job.id);
        }
    });
};

function getJobStatusClass(status) {
    switch (status) {
    case "RUNNING":
        return "job-running";
    case "COMPLETED":
        return "job-completed";
    case "FAILED":
        return "job-failed";
    case "SCHEDULED":
        return "job-scheduled";
    default:
        return "job-unknown";
    }
}

// Modify updateJobLists to use isRunning
window.updateJobLists = function (jobs) {
    jobs = jobs.filter(job => job.jobType !== "HOUSEKEEPING");

    // Filter out any running jobs
    const nonRunningJobs = jobs.filter(job => !job.isRunning);

    const completedJobs = nonRunningJobs
        .filter(job => job.lastExecutedStatus)
        .sort((a, b) => new Date(b.lastFinished) - new Date(a.lastFinished))
        .slice(0, 6);

    const upcomingJobs = nonRunningJobs
        .filter(job => job.jobStatus === "SCHEDULED" && job.nextExecutionTime)
        .sort((a, b) => new Date(a.nextExecutionTime) - new Date(b.nextExecutionTime))
        .slice(0, 10);

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

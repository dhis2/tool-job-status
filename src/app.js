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
    
    return !lastTask.completed && lastTask.level !== "ERROR";
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
                isRunning: job.jobStatus === "RUNNING" || isJobRunning(job.jobType, job.id, tasksData)
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

    // Begin new interval only if job is running
    modalInterval = setInterval(async () => {
        try {
            // Check if job is still running before updating
            const jobElement = document.querySelector(`[data-job-id="${jobId}"]`);
            const isJobRunning = jobElement?.classList.contains("job-running");
            
            if (!isJobRunning) {
                clearInterval(modalInterval);
                return;
            }

            const tasks = await d2Get(`/api/system/tasks/${jobType}/${jobId}`);
            const modalContent = document.getElementById("jobInfoModalContent");
            
            // Preserve existing prediction summary if present
            const existingSummary = modalContent.querySelector(".parameter-table");
            let formattedContent = "";

            // For completed predictor jobs, show summary
            if (jobType === "PREDICTOR") {
                const completedTask = tasks.find(task => 
                    task.message && task.message.includes("PredictionSummary"));
                
                if (completedTask) {
                    const summary = parsePredictionSummary(completedTask.message);
                    if (summary) {
                        formattedContent += formatPredictionSummary(summary);
                        formattedContent += "<hr>";
                    } else if (existingSummary) {
                        formattedContent += existingSummary.outerHTML + "<hr>";
                    }
                } else if (existingSummary) {
                    formattedContent += existingSummary.outerHTML + "<hr>";
                }
            }

            // Add task history
            formattedContent += tasks
                .slice(0, 5)
                .filter(task => task.message)
                .map(task => `
                    <div><strong>${task.time}</strong>: ${task.message}</div>
                `)
                .join("");

            modalContent.innerHTML = formattedContent || "No task details available";
        } catch (error) {
            console.error("Error fetching task details:", error);
        }
    }, 5000);
}

// Update the extractProgressFromTask function to handle action message better
function extractProgressFromTask(tasks) {
    const latestTask = tasks[0];
    if (latestTask?.level === "LOOP") {
        const match = latestTask.message.match(/\[(\d+)\/(\d+)\]/);
        if (match) {
            const current = parseInt(match[1]);
            const total = parseInt(match[2]);
            const percentage = Math.round((current / total) * 100);
            
            // Find the first non-LOOP message for action description
            const actionTask = tasks.find(task => task.level !== "LOOP");
            const action = actionTask ? actionTask.message : "Processing";
            
            return { percentage, action, isLoop: true };
        }
    }
    return { message: latestTask?.message, isLoop: false };
}

function startTaskPolling(jobType, jobId) {
    if (activeTaskPolls.has(jobId)) {
        return;
    }

    let lastMessage = "";
    let lastAction = null;
    let lastPercentage = null;
    
    const pollInterval = setInterval(async () => {
        try {
            const tasks = await d2Get(`/api/system/tasks/${jobType}/${jobId}`);
            const result = extractProgressFromTask(tasks);
            
            const progressDiv = document.getElementById(`progress-${jobId}`);
            if (progressDiv) {
                let newMessage = lastMessage;
                
                if (result.isLoop) {
                    // Only update action if it's defined
                    if (result.action && result.action.trim()) {
                        lastAction = result.action;
                    }
                    
                    if (result.percentage !== lastPercentage || !newMessage) {
                        newMessage = lastAction ? 
                            `<div>${lastAction}<br>${result.percentage}% complete</div>` : 
                            `<div>${result.percentage}% complete</div>`;
                        lastPercentage = result.percentage;
                    }
                } else if (tasks[0]?.level === "INFO" && tasks[0]?.message) {
                    // Only store/show non-empty messages
                    lastAction = tasks[0].message.trim();
                    newMessage = `<div>${lastAction}</div>`;
                    lastPercentage = null;
                }

                // Only update DOM if we have a valid message that changed
                if (newMessage && newMessage !== lastMessage) {
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
        <div class="status">Status: ${status}</div>
        <div>ID: ${job.id}</div>
        <div>Years: ${years}</div>
        ${renderAnalyticsParametersTable(job.jobParameters)}
        <div id="progress-${job.id}" class="progress-info" style="display: ${job.isRunning ? "block" : "none"}"></div>
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
        <div class="status">Status: ${status}</div>
        <div>Job Type: ${job.jobType}</div>
        <div>Last Executed: ${job.lastExecuted || "N/A"}</div>
        <div>Last Runtime: ${job.lastRuntimeExecution || "N/A"}</div>
        ${formattedParameters}
        <div id="progress-${job.id}" class="progress-info" style="display: ${job.isRunning ? "block" : "none"}"></div>
        <div class="card-footer">
            <button class="btn modal-trigger" data-target="jobInfoModal" onclick="showJobInfoModal('${job.jobType}', '${job.id}')">View Details</button>
        </div>
    `;
    return card;
}

// Add new function to update existing card content
function updateCardContent(job, existingCard) {
    const statusElement = existingCard.querySelector(".status");
    if (statusElement) {
        statusElement.textContent = `Status: ${job.jobStatus || "Unknown"}`;
    }
    
    // Update progress div visibility
    const progressDiv = existingCard.querySelector(`#progress-${job.id}`);
    if (progressDiv) {
        progressDiv.style.display = job.isRunning ? "block" : "none";
    }
    
    existingCard.className = `card ${job.jobType === "ANALYTICS_TABLE" ? "analytics-card" : ""} ${getJobStatusClass(job.jobStatus)}`;
}

// Modify renderRunningJobs to handle updates
window.renderRunningJobs = function(jobs) {
    const container = document.getElementById("runningJobsContainer");
    const existingCards = new Map(); // Store existing cards by job ID
    
    // Store existing cards before clearing container
    document.querySelectorAll("[data-job-id]").forEach(card => {
        existingCards.set(card.dataset.jobId, card);
    });

    container.innerHTML = ""; // Clear container but keep card references

    // Group jobs as before
    const activeQueues = new Set(
        jobs
            .filter(job => job.isRunning && job.jobType !== "HOUSEKEEPING" && job.queueName)
            .map(job => job.queueName)
    );

    // Handle queued jobs
    const queueMap = jobs.reduce((map, job) => {
        if (job.queueName && activeQueues.has(job.queueName)) {
            if (!map[job.queueName]) map[job.queueName] = [];
            map[job.queueName].push(job);
        }
        return map;
    }, {});

    // Handle independent jobs
    const independentJobs = jobs.filter(job => 
        !job.queueName && 
        job.isRunning && 
        job.jobType !== "HOUSEKEEPING"
    );

    let hasActiveJobs = Object.keys(queueMap).length > 0 || independentJobs.length > 0;

    // Render queued jobs
    Object.entries(queueMap).forEach(([queueName, queueJobs]) => {
        const queueContainer = document.createElement("div");
        queueContainer.className = "queue-container";

        const queueLabel = document.createElement("h5");
        queueLabel.textContent = queueName;
        queueContainer.appendChild(queueLabel);

        queueJobs
            .sort((a, b) => a.queuePosition - b.queuePosition)
            .forEach((job, index) => {
                let card = existingCards.get(job.id);
                if (card) {
                    // Update existing card
                    updateCardContent(job, card);
                    existingCards.delete(job.id); // Remove from map to track removed cards
                } else {
                    // Create new card
                    card = job.jobType === "ANALYTICS_TABLE"
                        ? createAnalyticsTableCard(job)
                        : createDefaultCard(job);
                    card.setAttribute("data-job-id", job.id);
                }

                // Update position label
                let positionLabel = card.querySelector(".position-label");
                if (!positionLabel) {
                    positionLabel = document.createElement("div");
                    positionLabel.className = "position-label";
                    card.appendChild(positionLabel);
                }
                positionLabel.textContent = `Job ${index + 1} of ${queueJobs.length}`;

                queueContainer.appendChild(card);
            });

        container.appendChild(queueContainer);
    });

    // Render independent jobs
    if (independentJobs.length > 0) {
        const independentContainer = document.createElement("div");
        independentContainer.className = "queue-container";
        
        const independentLabel = document.createElement("h5");
        independentLabel.textContent = "Now running";
        independentContainer.appendChild(independentLabel);

        independentJobs.forEach(job => {
            let card = existingCards.get(job.id);
            if (card) {
                updateCardContent(job, card);
                existingCards.delete(job.id);
            } else {
                card = job.jobType === "ANALYTICS_TABLE"
                    ? createAnalyticsTableCard(job)
                    : createDefaultCard(job);
                card.setAttribute("data-job-id", job.id);
            }
            independentContainer.appendChild(card);
        });

        container.appendChild(independentContainer);
    }

    if (!hasActiveJobs) {
        container.innerHTML = "<div class=\"card\"><div class=\"card-title\">No running jobs</div></div>";
    }

    // Update task polling
    for (const [jobId, interval] of activeTaskPolls.entries()) {
        if (!jobs.some(job => job.id === jobId && job.isRunning)) {
            clearInterval(interval);
            activeTaskPolls.delete(jobId);
        }
    }

    jobs.forEach(job => {
        if (job.isRunning && !activeTaskPolls.has(job.id)) {
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
    activeJobType = jobType;
    activeJobId = jobId;
    try {
        const tasks = await d2Get(`/api/system/tasks/${jobType}/${jobId}`);
        let formattedContent = "";

        // Check for prediction summary in completed tasks
        if (jobType === "PREDICTOR") {
            const completedTask = tasks.find(task => 
                task.message && task.message.includes("PredictionSummary"));
            
            if (completedTask) {
                const summary = parsePredictionSummary(completedTask.message);
                if (summary) {
                    formattedContent += formatPredictionSummary(summary);
                    formattedContent += "<hr>"; // Add separator
                }
            }
        }

        // Add task history
        formattedContent += tasks
            .slice(0, 5)
            .filter(task => task.message)
            .map(task => `
                <div><strong>${task.time}</strong>: ${task.message}</div>
            `)
            .join("");

        document.getElementById("jobInfoModalContent").innerHTML = 
            formattedContent || "No task details available";
        $("#jobInfoModal").modal("open");
    } catch (error) {
        document.getElementById("jobInfoModalContent").innerHTML = "Error loading task details.";
        console.error("Error fetching task details:", error);
    }
};

// Add function to parse prediction summary
function parsePredictionSummary(message) {
    const match = message.match(/PredictionSummary{(.+)}/);
    if (!match) return null;

    const summaryContent = match[1];
    const pairs = summaryContent.split(",").map(pair => pair.trim());
    const summary = {};

    pairs.forEach(pair => {
        const [key, value] = pair.split("=");
        if (key && value) {
            summary[key.trim()] = value.trim().replace(/'/g, "");
        }
    });

    return summary;
}

// Add function to format prediction summary as table
function formatPredictionSummary(summary) {
    if (!summary) return "";

    const rows = [
        ["Status", summary.status],
        ["Predictors", summary.predictors],
        ["Inserted values", summary.inserted],
        ["Updated values", summary.updated],
        ["Deleted values", summary.deleted],
        ["Unchanged values", summary.unchanged]
    ];

    return `
        <table class="parameter-table">
            <thead>
                <tr><th colspan="2">Prediction Summary</th></tr>
            </thead>
            <tbody>
                ${rows.map(([label, value]) => `
                    <tr>
                        <td>${label}</td>
                        <td>${value || "N/A"}</td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;
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

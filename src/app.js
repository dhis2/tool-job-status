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
        } catch (error) {
            console.error("Failed to fetch job configurations:", error);
        }
    }, 1000); // Poll every second
}

window.renderRunningJobs = function (jobs) {
    const container = document.getElementById("runningJobsContainer");
    container.innerHTML = ""; // Clear previous entries

    const runningJobs = jobs.filter((job) => job.jobStatus === "RUNNING");

    runningJobs.forEach((job) => {
        if (job.jobType === "ANALYTICS_TABLE") {
            const analyticTableCard = createAnalyticsTableCard(job);
            container.appendChild(analyticTableCard);
        } else {
            const defaultCard = createDefaultCard(job);
            container.appendChild(defaultCard);
        }
    });

};

function createAnalyticsTableCard(job) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
        <div class="card-title">${job.displayName} (Analytics Table)</div>
        <div>Job Type: ${job.jobType}</div>
        ${renderAnalyticsParametersTable(job.jobParameters)}
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
        "RESOURCE_TABLES",
        "DATA_VALUE",
        "COMPLETENESS",
        "COMPLETENESS_TARGET",
        "OUTLIER_STATISTICS",
        "EVENT",
        "ENROLLMENT",
        "TRACKED_ENTITY_INSTANCE",
        "TRACKED_ENTITY_INSTANCE_EVENTS",
        "TRACKED_ENTITY_INSTANCE_ENROLLMENTS",
        "OWNERSHIP"        
    ];

    const tableHTML = `
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
    </tbody></table>
    `;

    const skipProgramsHTML = `
    <div>Skip Programs:</div>
    <ul>
        ${skipPrograms.map((program) => `<li>${program}</li>`).join("")}
    </ul>
    `;

    return tableHTML + skipProgramsHTML;
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
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
        <div class="card-title">${job.displayName}</div>
        <div>Job Type: ${job.jobType}</div>
        <div>Last Executed: ${job.lastExecuted || "N/A"}</div>
        <div>Last Runtime: ${job.lastRuntimeExecution || "N/A"}</div>
        ${formattedParameters}
    `;
    return card;
}

function formatJobParameters(params) {
    if (!params) return "<div>No parameters available</div>";

    let formattedParams = "<div>Parameters:</div>";
    formattedParams +=
        '<table class="parameter-table"><thead><tr><th>Parameter</th><th>Value</th></tr></thead><tbody>';
    for (let key in params) {
        if (params.hasOwnProperty(key)) {
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
            const rowClass = job.queueName
                ? "queue-job"
                : job.jobStatus === "RUNNING"
                ? "running-job"
                : "";

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

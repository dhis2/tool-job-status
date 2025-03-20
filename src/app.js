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
    $('.modal').modal(); // Initialize modals
};

function pollJobConfigurations() {
    setInterval(async () => {
        try {
            const data = await d2Get("/api/jobConfigurations?fields=*");
            console.log("Fetched Job Configurations:", data);
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

    const runningJobs = jobs.filter(job => job.jobStatus === "RUNNING");

    runningJobs.forEach(job => {
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `
            <div class="card-title">${job.displayName}</div>
            <div>Job Type: ${job.jobType}</div>
            <div>Last Executed: ${job.lastExecuted || "N/A"}</div>
            <div>Last Runtime: ${job.lastRuntimeExecution || "N/A"}</div>
            ${renderParametersTable(job.jobParameters)}
        `;
        container.appendChild(card);
    });
    console.log("Rendered running jobs:", runningJobs);
};

function renderParametersTable(parameters) {
    if (!parameters || typeof parameters !== 'object') {
        return "<div>No parameters available</div>";
    }

    let table = '<table class="parameter-table"><thead><tr><th>Parameter</th><th>Value</th></tr></thead><tbody>';
    for (let key in parameters) {
        if (parameters.hasOwnProperty(key)) {
            table += `<tr><td>${key}</td><td>${parameters[key]}</td></tr>`;
        }
    }
    table += '</tbody></table>';

    return table;
}

window.updateJobsTable = function (jobs) {
    const nonSystemJobs = jobs.filter(job => !isSystemJob(job));

    const queueMap = nonSystemJobs.reduce((map, job) => {
        const queueName = job.queueName || "independent";
        if (!map[queueName]) {
            map[queueName] = [];
        }
        map[queueName].push(job);
        return map;
    }, {});

    const rowsData = [];
    Object.keys(queueMap).forEach(queueName => {
        const queueJobs = queueMap[queueName];
        queueJobs.sort((a, b) => a.nextExecutionTime.localeCompare(b.nextExecutionTime)); // Sort by next execution time

        const queueSize = queueJobs.length;
        queueJobs.forEach(job => {
            const queueIndicator = job.queueName ? `[Q ${1 + job.queuePosition} of ${queueSize}] ` : "";
            const switchControl = `<label><input type="checkbox" ${job.enabled ? 'checked' : ''}><div></div></label>`;
            const infoIcon = `<a href="#" class="waves-effect waves-light modal-trigger" data-target="jobInfoModal" onclick="showJobInfo('${JSON.stringify(job.jobParameters)}')"><i class="material-icons">info</i></a>`;
            const rowClass = job.queueName ? "queue-job" : (job.jobStatus === "RUNNING" ? "running-job" : "");

            rowsData.push([
                `${queueIndicator} ${job.displayName}`,
                job.id,
                job.jobType,
                job.schedulingType,
                job.nextExecutionTime || "N/A",
                job.jobStatus,
                switchControl,
                infoIcon
            ]);
        });
    });

    // Update DataTable entries without clearing previous configuration
    dataTable.clear().rows.add(rowsData).draw(false);
    console.log("Updated jobs table:", nonSystemJobs);
};

function initializeDataTable() {
    dataTable = $("#jobsTable").DataTable({
        retrieve: true,
        paging: true,
        pageLength: 50,
        autoWidth: false,
        responsive: true,
        order: [[4, 'asc']],
    });
}

function isSystemJob(job) {
    return job.jobType.includes("SYSTEM");
}

function formatJobParameters(params) {
    return typeof params === 'object' ? JSON.stringify(params, null, 2) : params;
}

window.showJobInfo = function (jobParameters) {
    try {
        const parsedParameters = JSON.parse(jobParameters);
        document.getElementById('jobParamsContent').innerHTML = formatJobParameters(parsedParameters);
    } catch (error) {
        document.getElementById('jobParamsContent').innerHTML = "No parameters available or invalid format";
        console.error("Error parsing job parameters:", error);
    }
    $('#jobInfoModal').modal('open');
};

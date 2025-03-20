"use strict";

import { d2Get } from "./js/d2api.js";
import $ from "jquery";
import "datatables.net";
import "./css/style.css";
import "materialize-css/dist/css/materialize.min.css";
import "datatables.net-dt/css/dataTables.dataTables.css";

let dataTable;

window.onload = function () {
    initializeDataTable();
    pollJobConfigurations();
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
        `;
        container.appendChild(card);
    });
    console.log("Rendered running jobs:", runningJobs);
};

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
        queueJobs.sort((a, b) => a.queuePosition - b.queuePosition); // Order based on queue position

        const queueSize = queueJobs.length;
        queueJobs.forEach(job => {
            const queueIndicator = job.queueName ? `[Q ${1 + job.queuePosition} of ${queueSize}] ` : "";
            const switchControl = `<label><input type="checkbox" ${job.enabled ? 'checked' : ''}><div></div></label>`;
            const rowClass = job.queueName ? "queue-job" : (job.jobStatus === "RUNNING" ? "running-job" : "");

            rowsData.push([
                `${queueIndicator}${job.displayName}`,
                job.id,
                job.jobType,
                job.schedulingType,
                job.nextExecutionTime || "N/A",
                job.jobStatus,
                switchControl
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
        pageLength: 50, // Set 50 entries per page by default
        autoWidth: false,
        responsive: true, // Ensure responsive behavior
        // Additional custom settings can be added here
    });
}

function isSystemJob(job) {
    // Implement logic to identify system jobs by specific attributes or identifying characteristics
    return job.jobType.includes("SYSTEM");
}

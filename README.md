# DHIS2 Job Status Tool
DHIS2 tool app designed for monitoring the exectuion of jobs and queues within the system. Showing currently running tasks/jobs, previously run jobs, and the next upcoming jobs. The app does a best-effort attempt to show correct information as provided by the API, but cannot be guaranteed to always show correct job info.

> **WARNING**
> This tool is intended to be used by system administrators to perform specific tasks, it is not intended for end users. It is available as a DHIS2 app, but has not been through the same rigorous testing as normal core apps. It should be used with care, and always tested in a development environment.


## License
© Copyright University of Oslo 2025

## Getting Started

### Install Dependencies
To install app dependencies, run:

### Install dependencies
To install app dependencies:

```
yarn install
```

### Compile to zip
To compile the app to a .zip file that can be installed in DHIS2:

```
yarn run zip
```

### Start dev server
To start the webpack development server:

```
yarn start
```

By default, webpack will start on port 8081, and assumes DHIS2 is running on 
http://localhost:8080/dhis with `admin:district` as the user and password.

A different DHIS2 instance can be used to develop against by adding a `d2auth.json` file like this:

```
{
    "baseUrl": "http://localhost:9000/dev",
    "username": "john_doe",
    "password": "District1!"
}
```

## Features
- **Real-Time Job Monitoring**: Automatically polls for job configurations and task statuses every 5 seconds.
- **UI for Running Jobs**: Display current running jobs and their progress, with cards that are dynamically updated.
- **Job Details Modal**: View info about individual jobs.
- **Upcoming and Last Jobs**: Lists jobs that have recently run and those scheduled to run in the future, with summary information provided.

## Usage
1. Launch the app to see currently running, previous and upcoming tasks.
2. Click on any job card to bring up the modal for detailed task analysis.

## Contributing
We welcome contributions! Please submit a pull request or open an issue if you'd like to add features or enhance existing functionality.

## Troubleshooting
If you experience issues, check the console for any errors related to API fetch operations or data rendering. 


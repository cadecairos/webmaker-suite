/****
 *
 * This is the installer for the Webmaker suite of projects.
 *
 * Run "node install", and you should be set.
 *
 * Use "node update" to bump every project to latest master.
 * (note:  not implemented yet)
 *
 * Use "node run" to fire up every project for testing.
 * (note:  not implemented yet)
 *
 ****/

/**
 * Installation script requirements
 */
var batchExec = require("./lib/batch").batchExec,
    checkError = require("./lib/batch").checkError,
    fs = require("fs"),
    runtime;

/**
 * This function houses all the installer code
 */
function runInstaller(runtime, commandStrings) {
  console.log("Finished bootstrapping.");

  console.log("\n===================================================================");
  console.log("Starting installation. You might want to go make a cup of coffee...");
  console.log("===================================================================");

  // Installation requirements
  var habitat = (function() {
        var habitat = require("habitat");
        habitat.load();
        return habitat;
      }()),
      gitOptions = new habitat("git"),
      username,
      password,
      gitCredentials = (function(options) {
        if (!options)
          return '';
        username = options.get("username"),
        password = options.get("password");
        if (!username || !password)
          return '';
        return username + ":" + password + "@";
      }(gitOptions)),
      repos = require("./lib/repos")(commandStrings);

  // Our list of apps that belong to the Webmaker Suite
  // This list will become a middleware list instead, so
  // that it's easier to manipulate, and easier to require
  // in other apps (like for "node run").
  var repositories = Object.keys(repos);

  /**
   * Set up the environment for specific repositories
   */
  function setupEnvironment(repositories, next) {
    if (repositories.length === 0) {
      return setTimeout(next, 10);
    };
    var repo = repositories.pop(),
        env = repos[repo].env;
    if (env) {
      console.log("setting up " + repo + " environment.");
      if (typeof env === "string") {
        process.chdir(repo);
        batchExec([env], function() {
          process.chdir("..");
          setupEnvironment(repositories, next);
        });
      }
      else if (typeof env === "function") {
        env(repo, fs, habitat);
        setupEnvironment(repositories, next);
      }
    } else { setupEnvironment(repositories, next); }
  }

  /**
   * Set up all the .env files so that all
   * repositories point to all the correct
   * other repositories.
   */
  function setupEnvironments() {
    console.log();
    setupEnvironment(repositories = Object.keys(repos), function() {
      console.log("\nInstallation complete.");
      process.exit(0);
    });
  };

  /**
   * Run npm install + npm cache clean for a repository.
   */
  function installModule(repositories, next) {
    if (repositories.length === 0) {
      return setTimeout(next, 10);
    };
    var repo = repositories.pop();
    console.log("resolving module dependencies for "+repo);
    process.chdir(repo);
    batchExec(repos[repo].install,
      function() {
        process.chdir("..");
        installModule(repositories, next);
      }
    );
  }

  /**
   * Run npm install + npm cache clean for all repositories.
   */
  function installModules() {
    if(runtime.skipnpm) {
      setupEnvironments();
    } else {
      console.log();
      installModule(repositories = Object.keys(repos), function() {
        setupEnvironments();
      });
    }
  }

  /**
   * When we have processed all repositories,
   * link them all up with relevant .env settings.
   */
  function tryNext(error, stdout, stderr) {
    checkError(error, stdout, stderr);

    // done cloning - set up the .env files
    if (repositories.length === 0) {
      installModules();
    }

    // clone the next repository
    else {
      var repo = repositories.pop(),
          repoURL = "https://" + gitCredentials + "github.com/mozilla/" + repo + ".git",
          rm = "rm -rf " + repo,
          clone = "git clone " + repoURL,
          commands = (runtime.skipclone ? [] : [rm, clone]);
      if(!runtime.skipclone) {
        console.log("\ncloning " + repo);
      }
      batchExec(commands, function(error, stdout, stderr) {
        checkError(error, stdout, stderr);

        process.chdir(repo);
        var commands = (runtime.skipclone ? [] : [
          "git submodule update --init --recursive",
          "git remote rename origin mozilla",
          "git remote add origin ssh://git@github.com/" + username + "/" + repo + ".git",
        ]);
        batchExec(commands, function() {
          process.chdir("..");
          tryNext();
        });
      });
    }
  };

  /**
   * clone all the repositories
   */
  tryNext();
}

/**
 * Runtime argument parsing
 */
function getRunTime() {
  var argv = require("argv");
  argv.option({
      name: 'username',
      type: 'string',
      description: 'Username for git',
      example: "'node install --username=username --password=password'"
  });
  argv.option({
      name: 'password',
      type: 'string',
      description: 'Password for git',
      example: "'node install --username=username --password=password'"
  });
  argv.option({
      name: 's3key',
      type: 'string',
      description: 'API key for Amazon Web Services\' S3',
      example: "'node install --s3key=abcdefg'"
  });
  argv.option({
      name: 's3secret',
      type: 'string',
      description: 'Secret key for Amazon Web Services\' S3',
      example: "'node install --s3key=abcdefg --s3secret=123456'"
  });
  argv.option({
      name: 'skipclone',
      type: 'string',
      description: 'Skip all \'git clone\' steps',
      example: "'node install --skipclone'"
  });
  argv.option({
      name: 'skipnpm',
      type: 'string',
      description: 'Skip all \'npm install\' and \'npm cache clean\' steps',
      example: "'node install --skipnpm'"
  });
  return argv.run().options;
}

/**
 * Bootstrap and run the installation
 */
(function bootStrap(){
  console.log("Bootstrapping installer...");

  var commandStrings = require("./lib/commandstrings"),
      npm = commandStrings.npm,
      commands = [
        "rm -rf node_modules",
        npm + " install --no-bin-links",
        npm + " cache clean"
      ];

  batchExec(commands, function() {
    runtime = getRunTime();

    // do we need an .env file?
    if (!fs.existsSync(".env")) {
      console.log("No .env file found.");

      /**
       * This funcitons writes the installer's .env file
       */
      var writeEnv = function (err, result) {
        if (err) { return onErr(err); }
        // write local .env
        var content = [
          'export GIT_USERNAME="' + result.username + '"',
          'export GIT_PASSWORD="' + result.password + '"',
          'export S3_KEY="'       + result.s3key    + '"',
          'export S3_SECRET="'    + result.s3secret + '"',
          ''].join("\n");
        fs.writeFileSync(".env", content);
        console.log(".env file created.");
        runInstaller(runtime, commandStrings);
      };

      // do we still need git username/password and s3 key/secret combinations?
      if (!runtime.username || !runtime.password || !runtime.s3key || !runtime.s3secret) {
        console.log("Please specify your git and AWS credentials:");
        var prompt = require("prompt");
        prompt.start();
        prompt.get(['username', 'password', 's3key', 's3secret'], writeEnv);
      }

      // we got the user/pass information from the runtime arguments
      else {
        writeEnv(null, {
          username: runtime.username,
          password: runtime.password,
          s3key: runtime.s3key,
          s3secret: runtime.s3secret
        });
      }
    }

    // we already had an .env file
    else { runInstaller(runtime, commandStrings); }
  });
}());

from flask import Flask
from flask_cors import CORS
import os
import sys
from pathlib import Path

from live_all_ulb import LOADER_ENABLED, get_loader
from routes.analytics import analytics_bp
from routes.live_all_ulb import live_all_ulb_bp
from routes.optimize_route import optimize_route_bp


def _should_autostart_live_loader():
    if not LOADER_ENABLED or os.environ.get("LIVE_ALL_ULB_AUTOSTART", "1") == "0" or "pytest" in sys.modules:
        return False
    # `python app.py` runs Flask's reloader: the parent process only watches files.
    if Path(sys.argv[0]).name == "app.py" and os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        return False
    return True


def create_app():
    """Create and configure the Flask application"""
    app = Flask(__name__)
    CORS(app, resources={r"/*": {"origins": "*"}})  # Enable CORS for all routes

    # Register blueprints
    app.register_blueprint(optimize_route_bp)
    app.register_blueprint(analytics_bp)
    app.register_blueprint(live_all_ulb_bp)
    # app.register_blueprint(waste_classification_bp)

    # When All-ULB live loading is switched on (LIVE_ALL_ULB_ENABLED=1), start it with the server so
    # today's snapshot is ready early. Other endpoints never touch the live loader or its database.
    if _should_autostart_live_loader():
        get_loader().start()

    # Add root route
    @app.route('/')
    def index():
        return {"status": "running", "message": "Flask app is up and running!"}

    return app


# This line makes 'app' available for waitress-serve
app = create_app()

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5001)
